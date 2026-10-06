import { randomUUID } from "node:crypto";
import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger } from "@nestjs/common";
import { defaultProvider } from "@aws-sdk/credential-providers";
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

  constructor(private readonly prisma: PrismaService) {}

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

  private async updateBinding(
    projectId: string,
    dto: UpsertAwsCrossAccountBindingDto,
  ): Promise<AwsCrossAccountBinding> {
    const existing = await this.getBindingByProjectId(projectId);

    const roleArn = dto.roleArn.trim();
    const regions = dto.regions?.length
      ? dto.regions.map((region) => this.normalizeRegion(region))
      : existing?.regions?.length
        ? existing.regions
        : [DEFAULT_REGION];
    const defaultRegion = this.normalizeRegion(dto.defaultRegion || existing?.defaultRegion || regions[0]);
    const externalId = existing?.externalId || randomUUID();

    // Verify trust before persisting: a role ARN that cannot be assumed is
    // rejected outright instead of leaving an unusable configured binding.
    const identity = await this.verifyRoleAssumption({
      roleArn,
      externalId,
      defaultRegion,
      sessionName: this.buildProbeSessionName(projectId),
    });

    const binding = existing
      ? await this.prisma.awsCrossAccountBinding.update({
          where: { id: existing.id },
          data: {
            roleArn,
            externalId,
            awsAccountId: identity.accountId || existing.awsAccountId,
            roleName: identity.iamUserName || existing.roleName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        })
      : await this.prisma.awsCrossAccountBinding.create({
          data: {
            projectId,
            roleArn,
            externalId,
            awsAccountId: identity.accountId,
            roleName: identity.iamUserName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        });

    this.invalidateSession(binding.id);
    return binding;
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
