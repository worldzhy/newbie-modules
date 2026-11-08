import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCrossAccountBinding } from "@generated/prisma/client";
import { UpsertAwsCrossAccountBindingDto } from "./aws-credentials.dto";
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

export interface ResolvedAwsCredentials {
  bindingId: string;
  roleArn: string;
  awsAccountId: string | null;
  roleName: string | null;
  defaultRegion: string;
  regions: string[];
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
export class AwsCredentialsService {
  private readonly logger = new Logger(AwsCredentialsService.name);
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

  async getProjectCredential(projectId: string) {
    const binding = await this.getBindingByProjectId(projectId);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Create the binding row with just a generated external ID so customers
   * can paste it into the role trust policy before saving the role ARN.
   * Idempotent: an existing row (bootstrapped or fully configured) wins.
   */
  async bootstrapProjectCredential(projectId: string) {
    const binding = await this.bootstrapBinding(projectId);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  async upsertProjectCredential(projectId: string, dto: UpsertAwsCrossAccountBindingDto) {
    const binding = await this.updateBinding(projectId, dto);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  /**
   * Start a two-phase identity replacement. The active identity keeps
   * serving while a pending external ID awaits the candidate role, so a
   * configuration change never leaves the host scope without credentials.
   * Idempotent: an open draft is returned as-is.
   */
  async rebindProjectCredential(projectId: string) {
    const binding = await this.startRebind(projectId);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  /** Abandon a pending identity replacement; the active identity is unaffected. */
  async cancelRebind(projectId: string) {
    const binding = await this.cancelPendingRebind(projectId);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  async verifyProjectCredential(projectId: string) {
    const { binding, identity } = await this.verifyBinding(projectId);
    return {
      ...this.serialize(projectId, binding, await this.resolveDefaultAccountId()),
      verification: identity,
    };
  }

  /**
   * Generate a new external ID. The customer must update the role trust
   * policy before verification can succeed again.
   */
  async rotateExternalId(projectId: string) {
    const binding = await this.rotateBindingExternalId(projectId);
    return this.serialize(projectId, binding, await this.resolveDefaultAccountId());
  }

  async deleteProjectCredential(projectId: string) {
    const existing = await this.getBindingByProjectId(projectId);
    if (existing) {
      await this.prisma.awsCrossAccountBinding.delete({ where: { id: existing.id } });
      this.invalidateSession(existing.id);
    }
    return { projectId, configured: false, credential: null, defaultAccountId: await this.resolveDefaultAccountId() };
  }

  // ---------------------------------------------------------------------------
  // Binding-level operations
  // ---------------------------------------------------------------------------

  private async getBindingByProjectId(projectId: string): Promise<AwsCrossAccountBinding | null> {
    return this.prisma.awsCrossAccountBinding.findUnique({ where: { projectId } });
  }

  private async bootstrapBinding(projectId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);
    if (existing) {
      return existing;
    }
    return this.prisma.awsCrossAccountBinding.create({
      data: {
        projectId,
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
   * - roleArn differs => a rebind draft must exist (POST :scopeId/rebind);
   *   the candidate is probed with the pending external ID and only a
   *   successful probe replaces the whole identity value object.
   *
   * The old external ID always retires with the old role, which is what
   * revokes the previous trust policy: it is no longer matched by any
   * request the platform makes.
   */
  private async updateBinding(
    projectId: string,
    dto: UpsertAwsCrossAccountBindingDto,
  ): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);

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

    // Identity unchanged: this is a scope edit. Re-probing STS would couple a
    // region edit to STS availability (and to unrelated credential outages),
    // and leaving a draft open would keep the UI in "rebinding" for an
    // identity the user just re-confirmed.
    if (existing?.roleArn && existing.roleArn === roleArn) {
      return this.prisma.awsCrossAccountBinding.update({
        where: { id: existing.id },
        data: { defaultRegion, regions, pendingExternalId: null },
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

    await this.assertRoleArnAvailable(projectId, roleArn);

    const identity = await this.verifyRoleAssumption({
      roleArn,
      externalId: probeExternalId,
      defaultRegion,
      sessionName: this.buildProbeSessionName(projectId),
    });

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
            awsAccountId: identity.accountId ?? null,
            roleName: identity.iamUserName ?? null,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        })
      : await this.prisma.awsCrossAccountBinding.create({
          data: {
            projectId,
            roleArn,
            externalId: probeExternalId,
            awsAccountId: identity.accountId ?? null,
            roleName: identity.iamUserName ?? null,
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
   * second host scope would make the unique constraint surface as a 500.
   */
  private async assertRoleArnAvailable(projectId: string, roleArn: string): Promise<void> {
    const conflict = await this.prisma.awsCrossAccountBinding.findFirst({
      where: { roleArn, projectId: { not: projectId } },
      select: { projectId: true },
    });
    if (conflict) {
      throw new ConflictException("This role ARN is already bound to another host scope");
    }
  }

  private async startRebind(projectId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);
    if (!existing?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this host scope");
    }
    if (existing.pendingExternalId) {
      return existing;
    }
    return this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: { pendingExternalId: randomUUID() },
    });
  }

  private async cancelPendingRebind(projectId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);
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

  private async verifyBinding(projectId: string): Promise<{
    binding: AwsCrossAccountBinding;
    identity: AwsCallerIdentity;
  }> {
    const existing = await this.getBindingByProjectId(projectId);
    if (!existing?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this host scope");
    }

    const credentials = this.resolveBindingCredentials(existing);
    const region = existing.defaultRegion || existing.regions[0] || DEFAULT_REGION;
    const identity = await getCallerIdentity(credentials, region).catch((error) => {
      throw this.toAssumptionException(error);
    });

    const binding = await this.prisma.awsCrossAccountBinding.update({
      where: { id: existing.id },
      data: {
        awsAccountId: identity.accountId || undefined,
        roleName: identity.iamUserName || undefined,
        lastVerifiedAt: new Date(),
      },
    });

    return { binding, identity };
  }

  private async rotateBindingExternalId(projectId: string): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);
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
   * Resolve the cross-account role for consumption by other modules.
   * Throws when no role is configured; the returned provider exchanges and
   * caches temporary credentials through STS AssumeRole.
   */
  async resolveProjectCredential(projectId: string): Promise<ResolvedAwsCredentials> {
    const binding = await this.getBindingByProjectId(projectId);
    if (!binding?.roleArn) {
      throw new BadRequestException("AWS cross-account role is not configured for this host scope");
    }
    const regions = binding.regions?.length ? binding.regions : [DEFAULT_REGION];
    return {
      bindingId: binding.id,
      roleArn: binding.roleArn,
      awsAccountId: binding.awsAccountId,
      roleName: binding.roleName,
      defaultRegion: binding.defaultRegion || regions[0],
      regions,
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

  /** One-off pre-persist probe session, keyed by the host scope id. */
  private buildProbeSessionName(projectId: string): string {
    return `nightwatch-probe-${projectId}`.slice(0, 64);
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

  private serialize(projectId: string, binding: AwsCrossAccountBinding | null, defaultAccountId: string | null) {
    if (!binding) {
      return { projectId, configured: false, credential: null, defaultAccountId };
    }
    return {
      projectId,
      configured: Boolean(binding.roleArn),
      credential: {
        id: binding.id,
        roleArn: binding.roleArn,
        externalId: binding.externalId,
        pendingExternalId: binding.pendingExternalId,
        awsAccountId: binding.awsAccountId,
        roleName: binding.roleName,
        defaultRegion: binding.defaultRegion,
        regions: binding.regions,
        lastVerifiedAt: binding.lastVerifiedAt,
        updatedAt: binding.updatedAt,
      },
      defaultAccountId,
    };
  }
}
