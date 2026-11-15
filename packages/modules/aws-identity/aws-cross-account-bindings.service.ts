import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { AwsCrossAccountBinding } from "@generated/prisma/client";
import { UpsertAwsCrossAccountBindingDto, UpdateAwsCrossAccountBindingNameDto } from "./aws-cross-account-bindings.dto";
import {
  assumeRole,
  AwsCallerIdentity,
  AwsCredentialsProvider,
  AwsTemporaryCredentials,
  getCallerIdentity,
  getDefaultCallerIdentity,
} from "./aws-sts.helper";

const DEFAULT_REGION = "us-east-1";
const SESSION_NAME_PREFIX = "nightwatch-";
/** Refresh assumed sessions this long before STS reports them expired. */
const REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000;
/** Fallback lifetime when STS omits an expiration (it never does in practice). */
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Credential-reference vocabulary: other modules point at a binding through an
 * opaque `"aws-binding:<id>"` string captured at their own registration time,
 * so resolving a subject to its credentials never requires rediscovering the
 * binding through the host's domain objects.
 */
export const AWS_BINDING_CREDENTIAL_REF_PREFIX = "aws-binding:";

/** Format the opaque credential reference naming one cross-account binding. */
export function awsBindingRef(bindingId: string): string {
  return `${AWS_BINDING_CREDENTIAL_REF_PREFIX}${bindingId}`;
}

export interface ResolvedAwsCredentials {
  bindingId: string;
  accountId: string;
  roleArn: string;
  roleName: string | null;
  defaultRegion: string;
  regions: string[];
  /** Rotation Lambda ARN configured for this account, or null when absent. */
  rotationLambdaArn: string | null;
  /**
   * Lazy temporary-credential source for AWS SDK clients. The implementation
   * re-reads the binding on every session exchange, caches the assumed
   * session, and refreshes it before expiry, so clients can be long-lived
   * without ever seeing a long-lived secret.
   */
  credentials: AwsCredentialsProvider;
}

interface AssumedSession {
  credentials: AwsTemporaryCredentials;
  expiresAt: number;
}

@Injectable()
export class AwsCrossAccountBindingsService {
  private readonly logger = new Logger(AwsCrossAccountBindingsService.name);
  private readonly sessionCache = new Map<string, Promise<AssumedSession>>();
  /**
   * Single host-default credential source shared by every default-plane
   * client (S3/SES/SMS and the STS client used for AssumeRole). The SDK
   * memoizes and auto-refreshes the resolved credentials internally.
   */
  private readonly defaultCredentialsProvider: AwsCredentialsProvider = defaultProvider();
  private defaultIdentityPromise: Promise<string | null> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Host default credentials (SDK default credential chain). All default
   * plane AWS clients receive this provider so identity resolution has a
   * single, testable exit point.
   */
  resolveDefaultCredentials(): AwsCredentialsProvider {
    return this.defaultCredentialsProvider;
  }

  // ---------------------------------------------------------------------------
  // Account-scoped operations (identity + usage scope)
  // ---------------------------------------------------------------------------

  async listAccountCredentials() {
    const [bindings, defaultAccountId] = await Promise.all([
      this.prisma.awsCrossAccountBinding.findMany({
        orderBy: { accountId: "asc" },
        include: { usages: { select: { consumerId: true } } },
      }),
      this.resolveDefaultAccountId(),
    ]);
    return {
      accounts: bindings.map(({ usages, ...binding }) => ({
        ...this.serializeBinding(binding),
        consumerIds: usages.map((usage) => usage.consumerId),
      })),
      defaultAccountId,
    };
  }

  async getAccountCredential(accountId: string) {
    const binding = await this.getBindingByAccountId(accountId);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Create the binding row with just a generated external ID so customers
   * can paste it into the role trust policy before saving the role ARN.
   * Idempotent: an existing row (bootstrapped or fully configured) wins.
   */
  async bootstrapAccountCredential(accountId: string) {
    const binding = await this.bootstrapBinding(accountId);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  async upsertAccountCredential(accountId: string, dto: UpsertAwsCrossAccountBindingDto) {
    const binding = await this.updateBinding(accountId, dto);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Rename an account. The display name is platform-side metadata, not part of
   * the identity exchange or the usage scope, so this path never probes STS and
   * works for accounts whose role has not been configured yet.
   */
  async renameAccount(accountId: string, dto: UpdateAwsCrossAccountBindingNameDto) {
    const existing = await this.getBindingByAccountId(accountId);
    if (!existing) {
      throw new NotFoundException("AWS cross-account binding is not bootstrapped");
    }
    const binding = await this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: { name: dto.name?.trim() || null },
    });
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Start a two-phase identity replacement. The active identity keeps
   * serving while a pending external ID awaits the candidate role, so a
   * configuration change never leaves the consumers without credentials.
   * Idempotent: an open draft is returned as-is.
   */
  async rebindAccountCredential(accountId: string) {
    const binding = await this.startRebind(accountId);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  /** Abandon a pending identity replacement; the active identity is unaffected. */
  async cancelRebind(accountId: string) {
    const binding = await this.cancelPendingRebind(accountId);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  async verifyAccountCredential(accountId: string) {
    const { binding, identity } = await this.verifyBinding(accountId);
    return {
      ...this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId()),
      verification: identity,
    };
  }

  /**
   * Generate a new external ID. The customer must update the role trust
   * policy before verification can succeed again.
   */
  async rotateExternalId(accountId: string) {
    const binding = await this.rotateBindingExternalId(accountId);
    return this.serializeAccount(accountId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Delete the account binding. Refused while any consumer still references
   * it: silently detaching consumers would leave projects pointing at
   * credentials that no longer exist.
   */
  async deleteAccountCredential(accountId: string) {
    const existing = await this.getBindingByAccountId(accountId);
    if (existing) {
      const usageCount = await this.prisma.awsCrossAccountBindingUsage.count({
        where: { bindingId: existing.id },
      });
      if (usageCount > 0) {
        throw new ConflictException(
          `This AWS account is referenced by ${usageCount} consumer(s); detach them before deleting the binding`,
        );
      }
      await this.prisma.awsCrossAccountBinding.delete({ where: { id: existing.id } });
      this.invalidateSession(existing.id);
    }
    return { accountId, configured: false, credential: null, defaultAccountId: await this.resolveDefaultAccountId() };
  }

  // ---------------------------------------------------------------------------
  // Consumer-scoped operations (references)
  // ---------------------------------------------------------------------------

  /** The account binding referenced by a consumer, rendered for the consumer page. */
  async getConsumerCredential(consumerId: string) {
    const binding = await this.getBindingByConsumerId(consumerId);
    return this.serializeConsumer(consumerId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Attach a consumer to a bootstrapped account (or move it to another one).
   * The account must exist so a typo cannot create a dangling reference.
   */
  async attachConsumerCredential(consumerId: string, accountId: string) {
    const binding = await this.getBindingByAccountId(accountId);
    if (!binding) {
      throw new NotFoundException(`AWS account ${accountId} is not bootstrapped`);
    }
    await this.prisma.awsCrossAccountBindingUsage.upsert({
      where: { consumerId },
      create: { consumerId, bindingId: binding.id },
      update: { bindingId: binding.id },
    });
    return this.serializeConsumer(consumerId, binding, await this.resolveDefaultAccountId());
  }

  async detachConsumerCredential(consumerId: string) {
    await this.prisma.awsCrossAccountBindingUsage.deleteMany({ where: { consumerId } });
    return this.serializeConsumer(consumerId, null, await this.resolveDefaultAccountId());
  }

  // ---------------------------------------------------------------------------
  // Binding-level operations
  // ---------------------------------------------------------------------------

  private async getBindingByAccountId(accountId: string): Promise<AwsCrossAccountBinding | null> {
    return this.prisma.awsCrossAccountBinding.findUnique({ where: { accountId } });
  }

  private async getBindingByConsumerId(consumerId: string): Promise<AwsCrossAccountBinding | null> {
    const usage = await this.prisma.awsCrossAccountBindingUsage.findUnique({
      where: { consumerId },
      include: { binding: true },
    });
    return usage?.binding ?? null;
  }

  private async bootstrapBinding(accountId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByAccountId(accountId);
    if (existing) {
      return existing;
    }
    return this.prisma.awsCrossAccountBinding.create({
      data: {
        accountId,
        externalId: randomUUID(),
        regions: [],
      },
    });
  }

  /**
   * Save the binding. Changing the identity is an atomic replacement, not a
   * field edit:
   *
   * - no active identity (roleArn null) => this is first access; the
   *   bootstrap external ID is the draft the role trust policy already uses.
   * - roleArn unchanged => only the usage scope changes: no probe, no
   *   rotation, and any open rebind draft is abandoned.
   * - roleArn differs => a rebind draft must exist (POST :accountId/rebind);
   *   the candidate is probed with the pending external ID and only a
   *   successful probe replaces the whole identity value object.
   *
   * The old external ID always retires with the old role, which is what
   * revokes the previous trust policy: it is no longer matched by any
   * request the platform makes.
   */
  private async updateBinding(
    accountId: string,
    dto: UpsertAwsCrossAccountBindingDto,
  ): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByAccountId(accountId);

    const roleArn = dto.roleArn.trim();
    // Regions are usage scope, not identity: an explicit list wins, an omitted
    // list keeps what is stored, and a new binding starts from the default
    // region. An explicitly empty list never reaches here (the DTO rejects it).
    const regions = dto.regions
      ? dto.regions.map((region) => this.normalizeRegion(region))
      : existing?.regions?.length
        ? existing.regions
        : [DEFAULT_REGION];

    // The default region must be one the binding is actually allowed to use;
    // otherwise callers that omit a region would operate outside the list.
    const requestedDefault = dto.defaultRegion ? this.normalizeRegion(dto.defaultRegion) : null;
    if (requestedDefault && !regions.includes(requestedDefault)) {
      throw new BadRequestException("Default region must be one of the configured regions");
    }
    const storedDefault = existing?.defaultRegion ? this.normalizeRegion(existing.defaultRegion) : null;
    const defaultRegion =
      requestedDefault || (storedDefault && regions.includes(storedDefault) ? storedDefault : regions[0]);

    // The rotation Lambda is account-scoped configuration, not identity:
    // omitted keeps the stored ARN, null clears it.
    const rotationLambdaArn =
      dto.rotationLambdaArn === undefined
        ? (existing?.rotationLambdaArn ?? null)
        : dto.rotationLambdaArn === null
          ? null
          : dto.rotationLambdaArn.trim();

    // The display name is platform-side metadata, not part of the identity
    // exchange: omitted keeps the stored name, null or blank clears it. A
    // rename therefore follows the same scope-edit path as the region list.
    const name = dto.name === undefined ? (existing?.name ?? null) : dto.name?.trim() || null;

    // Identity unchanged: this is a scope edit. Re-probing STS would couple a
    // region edit to STS availability (and to unrelated credential outages),
    // and leaving a draft open would keep the UI in "rebinding" for an
    // identity the user just re-confirmed.
    if (existing?.roleArn && existing.roleArn === roleArn) {
      return this.prisma.awsCrossAccountBinding.update({
        where: { id: existing.id },
        data: { name, defaultRegion, regions, rotationLambdaArn, pendingExternalId: null },
      });
    }

    // First access probes with the bootstrap draft; a replacement probes with
    // the pending draft. There is no third source of external IDs.
    const probeExternalId = existing?.roleArn ? existing.pendingExternalId : existing?.externalId || randomUUID();
    if (!probeExternalId) {
      throw new BadRequestException(
        "A pending external ID is required before the role ARN can change; start a rebind first",
      );
    }

    await this.assertRoleArnAvailable(accountId, roleArn);

    const identity = await this.verifyRoleAssumption({
      roleArn,
      externalId: probeExternalId,
      defaultRegion,
      sessionName: this.buildProbeSessionName(accountId),
    });
    this.assertIdentityMatchesAccount(accountId, identity);

    // One write replaces the identity value object, promotes the pending
    // external ID and clears the draft, so no mixed-generation row is ever
    // observable.
    const binding = existing
      ? await this.prisma.awsCrossAccountBinding.update({
          where: { id: existing.id },
          data: {
            roleArn,
            externalId: probeExternalId,
            pendingExternalId: null,
            roleName: identity.iamUserName ?? null,
            name,
            rotationLambdaArn,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        })
      : await this.prisma.awsCrossAccountBinding.create({
          data: {
            accountId,
            roleArn,
            externalId: probeExternalId,
            roleName: identity.iamUserName ?? null,
            name,
            rotationLambdaArn,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        });

    this.invalidateSession(binding.id);
    return binding;
  }

  /**
   * A role ARN identifies one role in one customer account; binding it to a
   * second account row would make the unique constraint surface as a 500.
   */
  private async assertRoleArnAvailable(accountId: string, roleArn: string): Promise<void> {
    const conflict = await this.prisma.awsCrossAccountBinding.findFirst({
      where: { roleArn, accountId: { not: accountId } },
      select: { accountId: true },
    });
    if (conflict) {
      throw new ConflictException("This role ARN is already bound to another AWS account");
    }
  }

  private async startRebind(accountId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByAccountId(accountId);
    if (!existing?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this account");
    }
    if (existing.pendingExternalId) {
      return existing;
    }
    return this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: { pendingExternalId: randomUUID() },
    });
  }

  private async cancelPendingRebind(accountId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByAccountId(accountId);
    if (!existing) {
      throw new BadRequestException("AWS cross-account binding is not bootstrapped");
    }
    if (!existing.pendingExternalId) {
      return existing;
    }
    return this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: { pendingExternalId: null },
    });
  }

  private async verifyBinding(accountId: string): Promise<{
    binding: AwsCrossAccountBinding;
    identity: AwsCallerIdentity;
  }> {
    const existing = await this.getBindingByAccountId(accountId);
    if (!existing?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this account");
    }

    const credentials = this.resolveBindingCredentials(existing);
    const region = existing.defaultRegion || existing.regions[0] || DEFAULT_REGION;
    const identity = await getCallerIdentity(credentials, region).catch((error) => {
      throw this.toAssumptionException(error);
    });
    this.assertIdentityMatchesAccount(accountId, identity);

    const binding = await this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: {
        roleName: identity.iamUserName || undefined,
        lastVerifiedAt: new Date(),
      },
    });

    return { binding, identity };
  }

  private async rotateBindingExternalId(accountId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByAccountId(accountId);
    if (!existing) {
      throw new BadRequestException("AWS cross-account binding is not bootstrapped");
    }

    const binding = await this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: { externalId: randomUUID() },
    });
    this.invalidateSession(binding.id);
    return binding;
  }

  /**
   * Resolve the cross-account role for consumption by other modules. The
   * caller's subject is the consumer id it already uses elsewhere; the
   * consumer -> account indirection stays inside this method so no consumer
   * module needs to know the account-scoped model.
   * Throws when no role is configured; the returned provider exchanges and
   * caches temporary credentials through STS AssumeRole.
   */
  async resolveProjectCredential(projectId: string): Promise<ResolvedAwsCredentials> {
    const binding = await this.getBindingByConsumerId(projectId);
    if (!binding?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this host scope");
    }
    return this.toResolvedCredentials(binding);
  }

  /**
   * Resolve the cross-account role by AWS account id. Account-scoped consumers
   * (e.g. aws-cloudwatch) address the binding directly instead of going through
   * a project usage row, so the account is the scope key end to end.
   * Throws when the account has no binding or no role configured.
   */
  async resolveAccountCredential(accountId: string): Promise<ResolvedAwsCredentials> {
    const binding = await this.getBindingByAccountId(accountId);
    if (!binding?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this account");
    }
    return this.toResolvedCredentials(binding);
  }

  /**
   * The rotation Lambda ARN configured for the account a consumer references.
   * Returns null (instead of throwing) when nothing is attached yet, so
   * callers can render a "not provisioned" state without treating it as an
   * error.
   */
  async resolveRotationLambdaArn(consumerId: string): Promise<string | null> {
    const binding = await this.getBindingByConsumerId(consumerId);
    return binding?.rotationLambdaArn ?? null;
  }

  /**
   * Resolve a binding through its opaque credential reference
   * (`"aws-binding:<id>"`, see awsBindingRef). Consumers register the
   * reference once and resolve it here on every use; a reference whose binding
   * or role no longer exists throws, which the caller surfaces as-is.
   */
  async resolveCredentialByRef(credentialRef: string): Promise<ResolvedAwsCredentials> {
    if (!credentialRef.startsWith(AWS_BINDING_CREDENTIAL_REF_PREFIX)) {
      throw new BadRequestException(`Unsupported AWS credential reference "${credentialRef}"`);
    }
    const bindingId = credentialRef.slice(AWS_BINDING_CREDENTIAL_REF_PREFIX.length);
    const binding = await this.prisma.awsCrossAccountBinding.findUnique({ where: { id: bindingId } });
    if (!binding?.roleArn) {
      throw new BadRequestException(
        `AWS credential reference "${credentialRef}" does not resolve to a configured cross-account role`,
      );
    }
    return this.toResolvedCredentials(binding);
  }

  private toResolvedCredentials(binding: AwsCrossAccountBinding): ResolvedAwsCredentials {
    const regions = binding.regions?.length ? binding.regions : [DEFAULT_REGION];
    return {
      bindingId: binding.id,
      accountId: binding.accountId,
      roleArn: binding.roleArn!,
      roleName: binding.roleName,
      defaultRegion: binding.defaultRegion || regions[0],
      regions,
      rotationLambdaArn: binding.rotationLambdaArn,
      credentials: this.resolveBindingCredentials(binding),
    };
  }

  /**
   * Return unexpired temporary credentials for the binding role. Concurrent
   * callers share a single in-flight AssumeRole; a failed assumption evicts
   * the cache entry so the next call retries. The binding is re-read on
   * every exchange so an external-ID rotation takes effect without having
   * to rebuild long-lived SDK clients.
   */
  private resolveBindingCredentials(binding: AwsCrossAccountBinding): AwsCredentialsProvider {
    return async () => {
      const session = await this.getAssumedSession(binding.id);
      return session.credentials;
    };
  }

  private async getAssumedSession(bindingId: string): Promise<AssumedSession> {
    const cached = this.sessionCache.get(bindingId);
    if (cached) {
      try {
        const session = await cached;
        if (session.expiresAt - REFRESH_SAFETY_WINDOW_MS > Date.now()) {
          return session;
        }
      } catch {
        // A failed probe is evicted below; fall through to a fresh attempt.
      }
      this.sessionCache.delete(bindingId);
    }

    const binding = await this.prisma.awsCrossAccountBinding.findUnique({ where: { id: bindingId } });
    if (!binding?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this host scope");
    }
    const region = binding.defaultRegion || binding.regions[0] || DEFAULT_REGION;

    const sessionPromise = assumeRole({
      roleArn: binding.roleArn,
      externalId: binding.externalId,
      region,
      sessionName: this.buildSessionName(binding.id),
      defaultCredentials: this.defaultCredentialsProvider,
    })
      .then(({ credentials, expiration }) => ({
        credentials,
        expiresAt: expiration ? expiration.getTime() : Date.now() + DEFAULT_SESSION_TTL_MS,
      }))
      .catch((error: unknown) => {
        this.sessionCache.delete(bindingId);
        throw this.toAssumptionException(error);
      });

    this.sessionCache.set(bindingId, sessionPromise);
    return sessionPromise;
  }

  private invalidateSession(bindingId: string): void {
    this.sessionCache.delete(bindingId);
  }

  private buildSessionName(bindingId: string): string {
    // Role session names allow [A-Za-z0-9_=,.@-] and cap at 64 chars;
    // "nightwatch-" (11) + UUID (36) stays well within the limit.
    return `${SESSION_NAME_PREFIX}${bindingId}`.slice(0, 64);
  }

  /** One-off pre-persist probe session, keyed by the customer account id. */
  private buildProbeSessionName(accountId: string): string {
    return `nightwatch-probe-${accountId}`.slice(0, 64);
  }

  private async verifyRoleAssumption(params: {
    roleArn: string;
    externalId: string;
    defaultRegion: string;
    sessionName: string;
  }): Promise<AwsCallerIdentity> {
    // Probe the assumption directly instead of persisting first; on success
    // the same identity response feeds the created/updated row.
    const { roleArn, externalId, defaultRegion, sessionName } = params;
    try {
      const { credentials } = await assumeRole({
        roleArn,
        externalId,
        region: defaultRegion,
        sessionName,
        defaultCredentials: this.defaultCredentialsProvider,
      });
      return await getCallerIdentity(credentials, defaultRegion);
    } catch (error) {
      throw this.toAssumptionException(error);
    }
  }

  /**
   * The account id is the binding's scope key, so it must describe the role's
   * real account. STS resolves the truth; a mismatch means the customer pasted
   * a role from a different account and must be rejected before persisting.
   */
  private assertIdentityMatchesAccount(accountId: string, identity: AwsCallerIdentity): void {
    if (identity.accountId && identity.accountId !== accountId) {
      throw new BadRequestException(
        `The role belongs to AWS account ${identity.accountId}, which does not match ${accountId}`,
      );
    }
  }

  /**
   * Map STS errors onto HTTP semantics. Only the non-sensitive error name and
   * AWS requestId are logged; raw SDK messages can contain account data.
   */
  private toAssumptionException(error: unknown): Error {
    // The credential provider already maps STS failures through this method;
    // pass its HttpException through unchanged instead of mapping it twice
    // (which would degrade a 400 trust error into a 502).
    if (error instanceof HttpException) {
      return error;
    }
    const { name, $metadata } = (error ?? {}) as {
      name?: string;
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    this.logger.warn(
      `STS AssumeRole failed: name=${name ?? "UnknownError"} ` +
        `status=${$metadata?.httpStatusCode ?? "n/a"} requestId=${$metadata?.requestId ?? "n/a"}`,
    );
    if (name === "AccessDenied" || name === "AccessDeniedException" || name === "InvalidIdentityToken") {
      return new BadRequestException(
        "The role could not be assumed. Verify the role ARN and that its trust policy allows the default account with this external ID.",
      );
    }
    return new BadGatewayException("STS AssumeRole request failed");
  }

  private async resolveDefaultAccountId(): Promise<string | null> {
    // The platform account ID is a static value. Prefer an explicit config
    // value so the backend does not need AWS credentials (or a successful STS
    // call) just to know its own account ID. Falls back to
    // sts:GetCallerIdentity when unset.
    const fromConfig = this.configService
      .get<{ platformAccountId?: string }>("modules.aws-identity")
      ?.platformAccountId?.trim();
    if (fromConfig) {
      return fromConfig;
    }
    if (!this.defaultIdentityPromise) {
      this.defaultIdentityPromise = getDefaultCallerIdentity(this.defaultCredentialsProvider)
        .then((identity) => identity.accountId)
        .catch((error: unknown) => {
          const name = (error as { name?: string })?.name ?? "UnknownError";
          this.logger.warn(`Default STS identity unavailable: name=${name}`);
          return null;
        });
      // Cached for the process lifetime, including null: the default account
      // does not change at runtime and every request would otherwise pay an
      // STS round trip (or a credential-chain timeout when AWS is unset).
    }
    return this.defaultIdentityPromise;
  }

  private normalizeRegion(region: string): string {
    return region.trim().toLowerCase();
  }

  private serializeBinding(binding: AwsCrossAccountBinding) {
    return {
      id: binding.id,
      accountId: binding.accountId,
      name: binding.name,
      roleArn: binding.roleArn,
      externalId: binding.externalId,
      pendingExternalId: binding.pendingExternalId,
      roleName: binding.roleName,
      rotationLambdaArn: binding.rotationLambdaArn,
      defaultRegion: binding.defaultRegion,
      regions: binding.regions,
      lastVerifiedAt: binding.lastVerifiedAt,
      updatedAt: binding.updatedAt,
    };
  }

  private serializeAccount(accountId: string, binding: AwsCrossAccountBinding | null, defaultAccountId: string | null) {
    if (!binding) {
      return { accountId, configured: false, credential: null, defaultAccountId };
    }
    return {
      accountId,
      configured: Boolean(binding.roleArn),
      credential: this.serializeBinding(binding),
      defaultAccountId,
    };
  }

  private serializeConsumer(
    consumerId: string,
    binding: AwsCrossAccountBinding | null,
    defaultAccountId: string | null,
  ) {
    return {
      consumerId,
      accountId: binding?.accountId ?? null,
      configured: Boolean(binding?.roleArn),
      credential: binding ? this.serializeBinding(binding) : null,
      defaultAccountId,
    };
  }
}
