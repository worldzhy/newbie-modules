import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";
import {
  CancelRotateSecretCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  ListSecretsCommand,
  RotateSecretCommand,
  SecretsManagerClient,
  TagResourceCommand,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import type { SecretListEntry } from "@aws-sdk/client-secrets-manager";
import {
  MANAGED_TAG_KEY,
  SECRET_TYPE_TAG_KEY,
  SECRET_TYPES,
  SecretType,
  SecretValueType,
} from "./aws-secrets-manager.types";
import { DEFAULT_LIST_PAGE_SIZE } from "./aws-secrets-manager.dto";
import type { SecretValuePayload } from "./aws-secrets-manager.dto";

const DEFAULT_ROTATION_DAYS = 30;
const DELETE_RECOVERY_WINDOW_DAYS = 30;

/** Bounded TTL for cached AWS clients: bounds memory and self-heals rotated credentials. */
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const CLIENT_CACHE_MAX_ENTRIES = 100;

interface ProjectContext {
  client: SecretsManagerClient;
  region: string;
}

interface CachedClient {
  client: SecretsManagerClient;
  expiresAt: number;
}

/**
 * Stateless read-through proxy over AWS Secrets Manager. AWS is the single
 * source of truth: no local table mirrors secret metadata. Project scoping
 * comes from the per-project AWS credential (each project points at its own
 * account), and managed secrets carry `nightwatch:managed` / `nightwatch:secret-type` tags.
 */
@Injectable()
export class AwsSecretsManagerService {
  private readonly logger = new Logger(AwsSecretsManagerService.name);
  private readonly clientCache = new Map<string, CachedClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: AwsCredentialsService,
  ) {}

  /**
   * Returns a single AWS page (cursor pagination). The opaque nextToken must be
   * passed back by the caller; total count is unknown without a full scan and
   * is therefore not returned.
   */
  async listSecrets(params: { projectId: string; pageSize?: number; nextToken?: string; region?: string }) {
    const { client, region } = await this.getProjectContext(params.projectId, params.region);

    const response = await this.callAws(() =>
      client.send(
        new ListSecretsCommand({
          Filters: [{ Key: "tag-key", Values: [MANAGED_TAG_KEY] }],
          MaxResults: params.pageSize ?? DEFAULT_LIST_PAGE_SIZE,
          ...(params.nextToken ? { NextToken: params.nextToken } : {}),
        }),
      ),
    );

    const records = (response.SecretList ?? []).map((entry) => this.toSecretResponse(entry, region));
    return { records, nextToken: response.NextToken ?? null };
  }

  async getSecret(projectId: string, name: string, region?: string) {
    const { client, region: resolvedRegion } = await this.getProjectContext(projectId, region);
    const entry = await this.callAws(() => client.send(new DescribeSecretCommand({ SecretId: name })));
    return this.toSecretResponse(entry, resolvedRegion);
  }

  async getSecretValue(
    projectId: string,
    name: string,
    region?: string,
  ): Promise<{ name: string; secretValue: SecretValuePayload; valueType: SecretValueType }> {
    const { client } = await this.getProjectContext(projectId, region);
    const response = await this.callAws(() =>
      client.send(new GetSecretValueCommand({ SecretId: name, VersionStage: "AWSCURRENT" })),
    );

    // Value reads are audited by the controller as `secret.value_read` business
    // events (actor/IP/resource), so no log-plane audit is emitted here.

    // Binary secrets cannot be created from this plane; return them as base64
    // so externally provisioned binary secrets do not turn into a 400.
    if (response.SecretBinary) {
      return { name, secretValue: Buffer.from(response.SecretBinary).toString("base64"), valueType: "binary" };
    }

    const raw = response.SecretString;
    if (raw === undefined) {
      return { name, secretValue: "", valueType: "text" };
    }

    // Only JSON objects map to the structured valueType; JSON scalars/arrays
    // and any non-JSON text are surfaced verbatim as plain text.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { name, secretValue: parsed as Record<string, unknown>, valueType: "json" };
      }
    } catch {
      // Not a JSON document: fall through to the verbatim text representation.
    }
    return { name, secretValue: raw, valueType: "text" };
  }

  async createSecret(params: {
    projectId: string;
    name: string;
    type: SecretType;
    description?: string;
    secretValue: SecretValuePayload;
    region?: string;
  }) {
    const { client, region } = await this.getProjectContext(params.projectId, params.region);
    // Value and tags are written in a single atomic CreateSecret call, so no
    // compensating cleanup is needed on later failures.
    await this.callAws(() =>
      client.send(
        new CreateSecretCommand({
          Name: params.name,
          Description: params.description,
          SecretString: this.serializeSecretValue(params.secretValue),
          Tags: [
            { Key: MANAGED_TAG_KEY, Value: "true" },
            { Key: SECRET_TYPE_TAG_KEY, Value: params.type },
          ],
        }),
      ),
    );
    return this.getSecret(params.projectId, params.name, region);
  }

  async updateSecret(
    projectId: string,
    name: string,
    data: { secretValue?: SecretValuePayload; description?: string; type?: SecretType; region?: string },
  ) {
    const { client, region } = await this.getProjectContext(projectId, data.region);

    if (data.secretValue !== undefined || data.description !== undefined) {
      await this.callAws(() =>
        client.send(
          new UpdateSecretCommand({
            SecretId: name,
            ...(data.secretValue !== undefined ? { SecretString: this.serializeSecretValue(data.secretValue) } : {}),
            ...(data.description !== undefined ? { Description: data.description } : {}),
          }),
        ),
      );
    }

    // TagResource overwrites the value of an existing tag key, so a type change
    // is a single call with no untag step.
    if (data.type !== undefined) {
      await this.callAws(() =>
        client.send(
          new TagResourceCommand({ SecretId: name, Tags: [{ Key: SECRET_TYPE_TAG_KEY, Value: data.type! }] }),
        ),
      );
    }

    return this.getSecret(projectId, name, region);
  }

  async deleteSecret(projectId: string, name: string, region?: string) {
    const { client } = await this.getProjectContext(projectId, region);
    // A 30-day recovery window is kept; recreating the same name inside the
    // window surfaces the AWS name-collision error unchanged.
    await this.callAws(() =>
      client.send(new DeleteSecretCommand({ SecretId: name, RecoveryWindowInDays: DELETE_RECOVERY_WINDOW_DAYS })),
    );
    return { name };
  }

  /** Trigger an immediate rotation using the existing rotation configuration. */
  async rotateSecret(projectId: string, name: string, region?: string) {
    const { client } = await this.getProjectContext(projectId, region);
    await this.callAws(() => client.send(new RotateSecretCommand({ SecretId: name })));
    return this.getSecret(projectId, name, region);
  }

  async setRotation(projectId: string, name: string, data: { enabled: boolean; days?: number; region?: string }) {
    const { client, region } = await this.getProjectContext(projectId, data.region);

    if (data.enabled) {
      const lambdaArn = await this.getRotationLambdaArn(projectId);
      if (!lambdaArn) {
        throw new BadRequestException(
          "Rotation Lambda ARN is not configured in Project Settings, cannot enable rotation",
        );
      }
      // RotateSecret both configures the rotation schedule and starts the first rotation.
      await this.callAws(() =>
        client.send(
          new RotateSecretCommand({
            SecretId: name,
            RotationLambdaARN: lambdaArn,
            RotationRules: { AutomaticallyAfterDays: data.days ?? DEFAULT_ROTATION_DAYS },
          }),
        ),
      );
    } else {
      // CancelRotateSecret turns off automatic rotation and cancels any in-progress one.
      await this.callAws(() => client.send(new CancelRotateSecretCommand({ SecretId: name })));
    }

    return this.getSecret(projectId, name, region);
  }

  // --- Helpers ---

  /** Objects are stored as JSON text; plain strings are stored verbatim. */
  private serializeSecretValue(secretValue: SecretValuePayload): string {
    return typeof secretValue === "string" ? secretValue : JSON.stringify(secretValue);
  }

  private async getProjectContext(projectId: string, region?: string): Promise<ProjectContext> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    const resolvedRegion = region ?? credential.defaultRegion;
    // The key is secret-free: the AssumeRole provider refreshes temporary
    // credentials inside the long-lived SDK client.
    const cacheKey = `${projectId}:${resolvedRegion}`;
    const now = Date.now();

    const cached = this.clientCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) {
        return { client: cached.client, region: resolvedRegion };
      }
      this.clientCache.delete(cacheKey);
      this.disposeClient(cached.client);
    }

    const client = new SecretsManagerClient({
      region: resolvedRegion,
      credentials: credential.credentials,
    });

    // Bounded LRU-ish eviction: Map preserves insertion order, so the first
    // key is the oldest entry. TTL expiry bounds staleness after credential
    // rotation; the entry cap bounds memory across projects/regions.
    if (this.clientCache.size >= CLIENT_CACHE_MAX_ENTRIES) {
      const oldestKey = this.clientCache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.clientCache.get(oldestKey);
        this.clientCache.delete(oldestKey);
        if (oldest) {
          this.disposeClient(oldest.client);
        }
      }
    }

    this.clientCache.set(cacheKey, { client, expiresAt: now + CLIENT_CACHE_TTL_MS });
    return { client, region: resolvedRegion };
  }

  /** Best-effort socket cleanup for evicted clients; never throws. */
  private disposeClient(client: SecretsManagerClient): void {
    try {
      client.destroy();
    } catch (error) {
      this.logger.debug(`Failed to close an evicted AWS client: ${(error as Error)?.name ?? "UnknownError"}`);
    }
  }

  private async getRotationLambdaArn(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { awsSecretsManagerRotationLambdaArn: true },
    });
    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }
    return project.awsSecretsManagerRotationLambdaArn;
  }

  private toSecretResponse(entry: SecretListEntry, region: string) {
    const type = entry.Tags?.find((tag) => tag.Key === SECRET_TYPE_TAG_KEY)?.Value ?? null;
    return {
      name: entry.Name!,
      arn: entry.ARN!,
      description: entry.Description ?? null,
      type: type && (SECRET_TYPES as readonly string[]).includes(type) ? (type as SecretType) : null,
      region,
      rotationEnabled: entry.RotationEnabled ?? false,
      rotationLambdaArn: entry.RotationLambdaARN ?? null,
      rotationRules: entry.RotationRules ?? null,
      lastRotatedAt: entry.LastRotatedDate ?? null,
      lastChangedAt: entry.LastChangedDate ?? null,
      createdAt: entry.CreatedDate ?? null,
    };
  }

  /**
   * Map AWS SDK errors onto HTTP semantics. Logs only the non-sensitive error
   * name, HTTP status and AWS requestId — raw SDK messages can contain ARNs
   * and account IDs and must never reach the log sink.
   */
  private toHttpException(error: unknown): HttpException {
    const { name, $metadata } = (error ?? {}) as {
      name?: string;
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    this.logger.warn(
      `AWS Secrets Manager call failed: name=${name ?? "UnknownError"} ` +
        `status=${$metadata?.httpStatusCode ?? "n/a"} requestId=${$metadata?.requestId ?? "n/a"}`,
    );
    switch (name) {
      case "ResourceNotFoundException":
        return new NotFoundException("Secret not found in AWS Secrets Manager");
      case "ResourceExistsException":
        return new ConflictException("A secret with this name already exists in AWS Secrets Manager");
      case "InvalidParameterException":
      case "InvalidRequestException":
      case "ValidationException":
        return new BadRequestException("Invalid request for AWS Secrets Manager");
      default:
        return new BadGatewayException("AWS Secrets Manager request failed");
    }
  }

  private async callAws<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw this.toHttpException(error);
    }
  }
}
