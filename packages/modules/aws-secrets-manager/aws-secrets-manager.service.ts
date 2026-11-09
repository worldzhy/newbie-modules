import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCrossAccountBindingsService } from "@modules/aws-identity/aws-cross-account-bindings.service";
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
import type { DescribeSecretResponse, SecretListEntry } from "@aws-sdk/client-secrets-manager";
import {
  ENV_GROUP_CUSTOM_ENV_FIELD,
  ENV_GROUP_PLATFORM_FIELD,
  ENV_GROUP_ROTATION_FIELD,
  MANAGED_TAG_KEY,
  SECRET_TYPE_TAG_KEY,
  SECRET_TYPES,
  SecretType,
  SecretValueType,
  envGroupSecretName,
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

/** One application's env group as read from AWS (no local mirror). */
export interface EnvGroupSnapshot {
  groupName: string;
  arn: string | null;
  exists: boolean;
  /** User-owned variables, written only through the PUT endpoint. */
  customEnv: Record<string, string>;
  /** Platform-owned variable names; values are never surfaced over HTTP. */
  platformKeys: string[];
  lastChangedAt: Date | null;
  createdAt: Date | null;
}

/**
 * Stateless read-through proxy over AWS Secrets Manager. AWS is the single
 * source of truth: no local table mirrors secret metadata. Project scoping
 * comes from the per-project AWS credential (each project points at its own
 * account), and managed secrets carry `devbie:managed` / `devbie:secret-type` tags.
 */
@Injectable()
export class AwsSecretsManagerService {
  private readonly logger = new Logger(AwsSecretsManagerService.name);
  private readonly clientCache = new Map<string, CachedClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: AwsCrossAccountBindingsService,
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
    const entry = await this.describeManagedSecret(client, name);
    return this.toSecretResponse(entry, resolvedRegion);
  }

  async getSecretValue(
    projectId: string,
    name: string,
    region?: string,
  ): Promise<{ name: string; secretValue: SecretValuePayload; valueType: SecretValueType }> {
    const { client } = await this.getProjectContext(projectId, region);
    // The project credential may see secrets provisioned outside this plane;
    // only rows this module created (carrying `devbie:managed`) are readable.
    await this.describeManagedSecret(client, name);
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
    await this.describeManagedSecret(client, name);

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
    await this.describeManagedSecret(client, name);
    // A 30-day recovery window is kept; recreating the same name inside the
    // window surfaces the AWS name-collision error unchanged.
    await this.callAws(() =>
      client.send(new DeleteSecretCommand({ SecretId: name, RecoveryWindowInDays: DELETE_RECOVERY_WINDOW_DAYS })),
    );
    return { name };
  }

  // --- Env group (one application = one group secret) ---

  /**
   * Read one application's env group. A missing secret is reported as
   * `exists: false` with empty values so the page can render the create form;
   * a secret at the composed name that this plane does not own stays 404
   * (same existence-hiding rule as by-name reads). Platform values are never
   * returned — only their names, so the UI can list read-only entries.
   */
  async getEnvGroup(projectId: string, groupId: string, region?: string): Promise<EnvGroupSnapshot> {
    const groupName = envGroupSecretName(projectId, groupId);
    const { client } = await this.getProjectContext(projectId, region);

    let entry: DescribeSecretResponse;
    try {
      entry = await this.callAws(() => client.send(new DescribeSecretCommand({ SecretId: groupName })));
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) {
        return {
          groupName,
          arn: null,
          exists: false,
          customEnv: {},
          platformKeys: [],
          lastChangedAt: null,
          createdAt: null,
        };
      }
      throw error;
    }
    this.assertManaged(entry);

    const document = await this.readGroupDocument(client, groupName);
    return {
      groupName,
      arn: entry.ARN ?? null,
      exists: true,
      customEnv: document.customEnv,
      platformKeys: Object.keys(document.platform),
      lastChangedAt: entry.LastChangedDate ?? null,
      createdAt: entry.CreatedDate ?? null,
    };
  }

  /**
   * Replace the group's user-owned env map atomically (create on first save).
   * Platform-owned (`__platform`) and reserved (`__rotation`) fields are carried
   * over untouched, so credential rotation and future rotation tooling keep
   * working without this write path knowing about them. Custom keys that
   * shadow a platform key are rejected: the deployment contract flattens
   * `{ ...platform, ...customEnv }`, so a shadowing key would silently override
   * a platform credential.
   */
  async updateEnvGroup(params: {
    projectId: string;
    groupId: string;
    customEnv: Record<string, string>;
    region?: string;
  }): Promise<EnvGroupSnapshot> {
    const groupName = envGroupSecretName(params.projectId, params.groupId);
    const { client, region } = await this.getProjectContext(params.projectId, params.region);
    const existing = await this.describeOptionalManagedSecret(client, groupName);

    if (existing) {
      const document = await this.readGroupDocument(client, groupName);
      this.assertNoPlatformCollision(params.customEnv, document.platform);
      const payload = this.buildGroupDocument(params.customEnv, document.platform, document.rotation);
      await this.callAws(() =>
        client.send(
          new UpdateSecretCommand({
            SecretId: groupName,
            SecretString: JSON.stringify(payload),
          }),
        ),
      );
    } else {
      const payload = this.buildGroupDocument(params.customEnv, {}, undefined);
      await this.callAws(() =>
        client.send(
          new CreateSecretCommand({
            Name: groupName,
            SecretString: JSON.stringify(payload),
            Tags: [
              { Key: MANAGED_TAG_KEY, Value: "true" },
              { Key: SECRET_TYPE_TAG_KEY, Value: "GENERIC_SECRET" },
            ],
          }),
        ),
      );
    }

    return this.getEnvGroup(params.projectId, params.groupId, region);
  }

  /**
   * Merge platform-managed variables (installation tokens/endpoints) into the
   * group's `__platform` field without touching custom user variables. `set`
   * keys overwrite existing platform values; `remove` keys are deleted from the
   * platform map. The `customEnv` and reserved `__rotation` fields are always
   * preserved. This is the single write path for installation credential
   * issuance/rotation — callers never touch the full group document, only the
   * platform-owned keys.
   */
  async mergePlatformEnvVars(params: {
    projectId: string;
    groupId: string;
    set?: Record<string, string>;
    remove?: string[];
    region?: string;
  }): Promise<EnvGroupSnapshot> {
    const groupName = envGroupSecretName(params.projectId, params.groupId);
    const { client, region } = await this.getProjectContext(params.projectId, params.region);
    const existing = await this.describeOptionalManagedSecret(client, groupName);

    let currentPlatform: Record<string, string> = {};
    let customEnv: Record<string, string> = {};
    let rotation: unknown;
    if (existing) {
      const document = await this.readGroupDocument(client, groupName);
      customEnv = document.customEnv;
      currentPlatform = document.platform;
      rotation = document.rotation;
    }

    const nextPlatform = { ...currentPlatform };
    if (params.set) {
      Object.assign(nextPlatform, params.set);
    }
    if (params.remove?.length) {
      for (const key of params.remove) {
        delete nextPlatform[key];
      }
    }

    // Skip the AWS update when nothing changed and the group already exists —
    // avoids needlessly rotating the secret version. A non-existent group is
    // always created (empty maps if no set values were supplied).
    const setChanged = params.set ? !Object.entries(params.set).every(([k, v]) => currentPlatform[k] === v) : false;
    const removedAny =
      (params.remove?.length ?? 0) > 0 && (params.remove as string[]).some((k) => k in currentPlatform);
    const anyChange = setChanged || removedAny;

    // If the group doesn't exist yet, always create it — every application must
    // have a group on creation (ADR-005 §4), even if no platform-managed vars
    // are being set. A no-op merge against a non-existent group creates an
    // empty platform map and exits with arn/metadata populated.
    if (!existing) {
      const payload = this.buildGroupDocument(customEnv, nextPlatform, undefined);
      await this.callAws(() =>
        client.send(
          new CreateSecretCommand({
            Name: groupName,
            SecretString: JSON.stringify(payload),
            Tags: [
              { Key: MANAGED_TAG_KEY, Value: "true" },
              { Key: SECRET_TYPE_TAG_KEY, Value: "GENERIC_SECRET" },
            ],
          }),
        ),
      );
      return this.getEnvGroup(params.projectId, params.groupId, region);
    }

    if (!anyChange) {
      return this.getEnvGroup(params.projectId, params.groupId, region);
    }

    const payload = this.buildGroupDocument(customEnv, nextPlatform, rotation);
    await this.callAws(() =>
      client.send(
        new UpdateSecretCommand({
          SecretId: groupName,
          SecretString: JSON.stringify(payload),
        }),
      ),
    );

    return this.getEnvGroup(params.projectId, params.groupId, region);
  }

  async deleteEnvGroup(projectId: string, groupId: string, region?: string) {
    const groupName = envGroupSecretName(projectId, groupId);
    const { client } = await this.getProjectContext(projectId, region);
    await this.describeManagedSecret(client, groupName);
    await this.callAws(() =>
      client.send(new DeleteSecretCommand({ SecretId: groupName, RecoveryWindowInDays: DELETE_RECOVERY_WINDOW_DAYS })),
    );
    return { groupName };
  }

  /** Trigger an immediate rotation using the existing rotation configuration. */
  async rotateSecret(projectId: string, name: string, region?: string) {
    const { client } = await this.getProjectContext(projectId, region);
    await this.describeManagedSecret(client, name);
    await this.callAws(() => client.send(new RotateSecretCommand({ SecretId: name })));
    return this.getSecret(projectId, name, region);
  }

  async setRotation(projectId: string, name: string, data: { isEnabled: boolean; days?: number; region?: string }) {
    const { client, region } = await this.getProjectContext(projectId, data.region);
    await this.describeManagedSecret(client, name);

    if (data.isEnabled) {
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

  /**
   * The module only owns secrets it created. AWS permissions of a project
   * credential may reach unrelated secrets in the same account, so every
   * by-name read/write first proves the `devbie:managed` tag. An unmanaged
   * secret is reported as not found — the caller has no business knowing it
   * exists.
   */
  private async describeManagedSecret(client: SecretsManagerClient, name: string) {
    const entry = await this.callAws(() => client.send(new DescribeSecretCommand({ SecretId: name })));
    this.assertManaged(entry);
    return entry;
  }

  /**
   * Like {@link describeManagedSecret}, but an absent secret returns undefined
   * so the caller can create it on first write. A secret that exists but was
   * not created by this plane is still rejected as not found.
   */
  private async describeOptionalManagedSecret(
    client: SecretsManagerClient,
    name: string,
  ): Promise<DescribeSecretResponse | undefined> {
    let entry: DescribeSecretResponse;
    try {
      entry = await client.send(new DescribeSecretCommand({ SecretId: name }));
    } catch (error) {
      if (this.isAwsNotFound(error)) {
        return undefined;
      }
      throw this.toHttpException(error);
    }
    this.assertManaged(entry);
    return entry;
  }

  /** Reject entries that do not carry the `devbie:managed` ownership tag. */
  private assertManaged(entry: DescribeSecretResponse): void {
    const managed = entry.Tags?.some((tag) => tag.Key === MANAGED_TAG_KEY && tag.Value === "true") ?? false;
    if (!managed) {
      throw new NotFoundException("Secret not found in AWS Secrets Manager");
    }
  }

  private isAwsNotFound(error: unknown): boolean {
    return (
      typeof error === "object" && error !== null && (error as { name?: string }).name === "ResourceNotFoundException"
    );
  }

  /**
   * Parse a group secret into its user-owned map, platform-owned map and the
   * reserved `__rotation` recipe. The document shape is
   * `{ "customEnv": {...}, "__platform": {...}, "__rotation": {...} }`;
   * malformed documents are rejected rather than silently coerced. A document
   * written before the `customEnv`/`__platform` split (flat `env`) is treated
   * as empty — there is deliberately no migration reader for it.
   */
  private async readGroupDocument(
    client: SecretsManagerClient,
    name: string,
  ): Promise<{ customEnv: Record<string, string>; platform: Record<string, string>; rotation?: unknown }> {
    const response = await this.callAws(() =>
      client.send(new GetSecretValueCommand({ SecretId: name, VersionStage: "AWSCURRENT" })),
    );
    const raw = response.SecretString;
    if (raw === undefined) {
      return { customEnv: {}, platform: {} };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException("Env group secret is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequestException("Env group secret is not a JSON object");
    }

    const document = parsed as Record<string, unknown>;
    return {
      customEnv: this.readStringMap(document[ENV_GROUP_CUSTOM_ENV_FIELD], ENV_GROUP_CUSTOM_ENV_FIELD),
      platform: this.readStringMap(document[ENV_GROUP_PLATFORM_FIELD], ENV_GROUP_PLATFORM_FIELD),
      rotation: document[ENV_GROUP_ROTATION_FIELD],
    };
  }

  /** Normalize one flat `string → string` group field; `undefined` maps to `{}`. */
  private readStringMap(value: unknown, field: string): Record<string, string> {
    if (value === undefined) {
      return {};
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new BadRequestException(`Env group secret has an unexpected ${field} field`);
    }

    const normalized: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "string") {
        throw new BadRequestException(`Env group secret contains a non-string value in ${field}`);
      }
      normalized[key] = entry;
    }
    return normalized;
  }

  /**
   * Reject custom keys that collide with platform-owned keys. The deployment
   * contract flattens `{ ...platform, ...customEnv }`; allowing a collision
   * would let a user-supplied value silently override a platform credential.
   */
  private assertNoPlatformCollision(customEnv: Record<string, string>, platform: Record<string, string>): void {
    const collisions = Object.keys(customEnv).filter((key) => key in platform);
    if (collisions.length > 0) {
      // Key names are non-sensitive; values are never included.
      throw new ConflictException(`Custom env keys shadow platform-managed keys: ${collisions.sort().join(", ")}`);
    }
  }

  /**
   * Build the group JSON with the three owned fields. `customEnv` and
   * `__platform` are always written (empty maps included); `__rotation` is
   * written only when present.
   */
  private buildGroupDocument(
    customEnv: Record<string, string>,
    platform: Record<string, string>,
    rotation: unknown,
  ): Record<string, unknown> {
    const document: Record<string, unknown> = {
      [ENV_GROUP_CUSTOM_ENV_FIELD]: customEnv,
      [ENV_GROUP_PLATFORM_FIELD]: platform,
    };
    if (rotation !== undefined) {
      document[ENV_GROUP_ROTATION_FIELD] = rotation;
    }
    return document;
  }

  private toSecretResponse(entry: SecretListEntry, region: string) {
    const type = entry.Tags?.find((tag) => tag.Key === SECRET_TYPE_TAG_KEY)?.Value ?? null;
    return {
      name: entry.Name!,
      arn: entry.ARN!,
      description: entry.Description ?? null,
      type: type && (SECRET_TYPES as readonly string[]).includes(type) ? (type as SecretType) : null,
      region,
      isRotationEnabled: entry.RotationEnabled ?? false,
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
      case "TimeoutError":
      case "NetworkingError":
      case "ETIMEDOUT":
      case "ECONNRESET":
      case "EPIPE":
        return new ServiceUnavailableException("AWS Secrets Manager is temporarily unavailable");
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
