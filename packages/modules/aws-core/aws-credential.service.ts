import { randomUUID } from "node:crypto";
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ProjectAwsCredential } from "@generated/prisma/client";
import { UpsertProjectAwsCredentialDto } from "./aws-credential.dto";
import {
  assumeRole,
  AwsCredentialsProvider,
  AwsTemporaryCredentials,
  getCallerIdentity,
  getPlatformCallerIdentity,
} from "./aws-sts.helper";

const DEFAULT_REGION = "us-east-1";
/** Refresh assumed sessions this long before STS reports them expired. */
const REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000;
/** Fallback lifetime when STS omits an expiration (it never does in practice). */
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

export interface ResolvedAwsCredential {
  roleArn: string;
  externalId: string;
  defaultRegion: string;
  regions: string[];
  awsAccountId: string | null;
  iamUserName: string | null;
  /**
   * Lazy temporary-credential source for AWS SDK clients. The implementation
   * caches the assumed session and refreshes it before expiry, so clients can
   * be long-lived without ever seeing a long-lived secret.
   */
  credentials: AwsCredentialsProvider;
}

interface AssumedSession {
  credentials: AwsTemporaryCredentials;
  expiresAt: number;
}

@Injectable()
export class AwsCredentialService {
  private readonly logger = new Logger(AwsCredentialService.name);
  private readonly sessionCache = new Map<string, Promise<AssumedSession>>();
  private platformIdentityPromise: Promise<string | null> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getProjectCredential(projectId: string) {
    await this.ensureProjectExists(projectId);
    const record = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });
    return this.serialize(projectId, record, await this.resolvePlatformAccountId());
  }

  /**
   * Create the credential row with just a generated external ID so customers
   * can paste it into the role trust policy before saving the role ARN.
   * Idempotent: an existing row (bootstrapped or fully configured) wins.
   */
  async bootstrapProjectCredential(projectId: string) {
    await this.ensureProjectExists(projectId);
    let record = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });
    if (!record) {
      record = await this.prisma.projectAwsCredential.create({
        data: {
          projectId,
          externalId: randomUUID(),
          regions: [],
        },
      });
    }
    return this.serialize(projectId, record, await this.resolvePlatformAccountId());
  }

  async upsertProjectCredential(projectId: string, dto: UpsertProjectAwsCredentialDto) {
    await this.ensureProjectExists(projectId);

    const existing = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });

    const roleArn = dto.roleArn.trim();

    const regions = dto.regions?.length
      ? dto.regions.map((region) => this.normalizeRegion(region))
      : existing?.regions?.length
        ? existing.regions
        : [DEFAULT_REGION];
    const defaultRegion = this.normalizeRegion(dto.defaultRegion || existing?.defaultRegion || regions[0]);
    const externalId = existing?.externalId || randomUUID();

    // Verify trust before persisting: a role ARN that cannot be assumed is
    // rejected outright instead of leaving an unusable configured record.
    const identity = await this.verifyRoleAssumption({ roleArn, externalId, defaultRegion, projectId });

    const record = existing
      ? await this.prisma.projectAwsCredential.update({
          where: { id: existing.id },
          data: {
            roleArn,
            externalId,
            awsAccountId: identity.accountId || existing.awsAccountId,
            iamUserName: identity.iamUserName || existing.iamUserName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        })
      : await this.prisma.projectAwsCredential.create({
          data: {
            projectId,
            roleArn,
            externalId,
            awsAccountId: identity.accountId,
            iamUserName: identity.iamUserName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        });

    this.invalidateSession(projectId);
    return this.serialize(projectId, record, await this.resolvePlatformAccountId());
  }

  async verifyProjectCredential(projectId: string) {
    const resolved = await this.resolveProjectCredential(projectId);
    const identity = await getCallerIdentity(resolved.credentials, resolved.defaultRegion).catch((error) => {
      throw this.toAssumptionException(error);
    });

    const record = await this.prisma.projectAwsCredential.update({
      where: { projectId },
      data: {
        awsAccountId: identity.accountId || undefined,
        iamUserName: identity.iamUserName || undefined,
        lastVerifiedAt: new Date(),
      },
    });

    return {
      ...this.serialize(projectId, record, await this.resolvePlatformAccountId()),
      verification: identity,
    };
  }

  /**
   * Generate a new external ID. The customer must update the role trust
   * policy before verification can succeed again.
   */
  async rotateExternalId(projectId: string) {
    await this.ensureProjectExists(projectId);
    const existing = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });
    if (!existing) {
      throw new BadRequestException("Project AWS credential is not bootstrapped");
    }

    const record = await this.prisma.projectAwsCredential.update({
      where: { id: existing.id },
      data: { externalId: randomUUID() },
    });
    this.invalidateSession(projectId);
    return this.serialize(projectId, record, await this.resolvePlatformAccountId());
  }

  async deleteProjectCredential(projectId: string) {
    await this.ensureProjectExists(projectId);
    await this.prisma.projectAwsCredential.delete({ where: { projectId } }).catch(() => undefined);
    this.invalidateSession(projectId);
    return { projectId, configured: false, credential: null, platformAccountId: await this.resolvePlatformAccountId() };
  }

  /**
   * Resolve the cross-account role for consumption by other microservices.
   * Throws when no role is configured; the returned provider exchanges and
   * caches temporary credentials through STS AssumeRole.
   */
  async resolveProjectCredential(projectId: string): Promise<ResolvedAwsCredential> {
    const record = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });
    if (!record?.roleArn) {
      throw new BadRequestException("Project AWS cross-account role is not configured");
    }
    const regions = record.regions?.length ? record.regions : [DEFAULT_REGION];
    const defaultRegion = record.defaultRegion || regions[0];
    return {
      roleArn: record.roleArn,
      externalId: record.externalId,
      defaultRegion,
      regions,
      awsAccountId: record.awsAccountId,
      iamUserName: record.iamUserName,
      credentials: () => this.getAssumedCredentials(projectId),
    };
  }

  /**
   * Return unexpired temporary credentials for the project role. Concurrent
   * callers share a single in-flight AssumeRole; a failed assumption evicts
   * the cache entry so the next call retries.
   */
  private async getAssumedCredentials(projectId: string): Promise<AwsTemporaryCredentials> {
    const now = Date.now();
    const cached = this.sessionCache.get(projectId);
    if (cached) {
      const session = await cached;
      if (session.expiresAt - REFRESH_SAFETY_WINDOW_MS > now) {
        return session.credentials;
      }
      this.sessionCache.delete(projectId);
    }

    const record = await this.prisma.projectAwsCredential.findUnique({ where: { projectId } });
    if (!record?.roleArn) {
      throw new BadRequestException("Project AWS cross-account role is not configured");
    }
    const region = record.defaultRegion || record.regions[0] || DEFAULT_REGION;

    const sessionPromise = assumeRole({
      roleArn: record.roleArn,
      externalId: record.externalId,
      region,
      sessionName: this.buildSessionName(projectId),
    })
      .then(({ credentials, expiration }) => ({
        credentials,
        expiresAt: expiration ? expiration.getTime() : Date.now() + DEFAULT_SESSION_TTL_MS,
      }))
      .catch((error: unknown) => {
        this.sessionCache.delete(projectId);
        throw this.toAssumptionException(error);
      });

    this.sessionCache.set(projectId, sessionPromise);
    const session = await sessionPromise;
    return session.credentials;
  }

  private invalidateSession(projectId: string): void {
    this.sessionCache.delete(projectId);
  }

  private buildSessionName(projectId: string): string {
    // Role session names allow [A-Za-z0-9_=,.@-] and cap at 64 chars;
    // "nightwatch-" (11) + UUID (36) stays well within the limit.
    return `nightwatch-${projectId}`.slice(0, 64);
  }

  private async verifyRoleAssumption(params: {
    roleArn: string;
    externalId: string;
    defaultRegion: string;
    projectId: string;
  }) {
    // Probe the assumption directly instead of persisting first; on success
    // the same identity response feeds the created/updated row.
    const { roleArn, externalId, defaultRegion, projectId } = params;
    try {
      const { credentials } = await assumeRole({
        roleArn,
        externalId,
        region: defaultRegion,
        sessionName: this.buildSessionName(projectId),
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
        "The role could not be assumed. Verify the role ARN and that its trust policy allows the platform account with this external ID.",
      );
    }
    return new BadGatewayException("STS AssumeRole request failed");
  }

  private async resolvePlatformAccountId(): Promise<string | null> {
    if (!this.platformIdentityPromise) {
      this.platformIdentityPromise = getPlatformCallerIdentity()
        .then((identity) => identity.accountId)
        .catch((error: unknown) => {
          const name = (error as { name?: string })?.name ?? "UnknownError";
          this.logger.warn(`Platform STS identity unavailable: name=${name}`);
          return null;
        });
      // Cached for the process lifetime, including null: the platform account
      // does not change at runtime and every request would otherwise pay an
      // STS round trip (or a credential-chain timeout when AWS is unset).
    }
    return this.platformIdentityPromise;
  }

  private normalizeRegion(region: string): string {
    return region.trim().toLowerCase();
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
  }

  private serialize(projectId: string, record: ProjectAwsCredential | null, platformAccountId: string | null) {
    if (!record) {
      return { projectId, configured: false, credential: null, platformAccountId };
    }
    return {
      projectId,
      configured: Boolean(record.roleArn),
      credential: {
        id: record.id,
        roleArn: record.roleArn,
        externalId: record.externalId,
        awsAccountId: record.awsAccountId,
        iamUserName: record.iamUserName,
        defaultRegion: record.defaultRegion,
        regions: record.regions,
        lastVerifiedAt: record.lastVerifiedAt,
        updatedAt: record.updatedAt,
      },
      platformAccountId,
    };
  }
}
