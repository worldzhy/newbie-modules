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
import { AwsCredentialService } from "@modules/aws-core/aws-credential.service";
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
import { MANAGED_TAG_KEY, SECRET_TYPE_TAG_KEY, SECRET_TYPES, SecretType } from "./aws-secrets-manager.types";

const DEFAULT_ROTATION_DAYS = 30;
const DELETE_RECOVERY_WINDOW_DAYS = 30;
const LIST_PAGE_SIZE = 100;

interface ProjectContext {
  client: SecretsManagerClient;
  region: string;
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
  private readonly clientCache = new Map<string, SecretsManagerClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: AwsCredentialService,
  ) {}

  async listSecrets(params: { projectId: string; page: number; pageSize: number; region?: string }) {
    const { client, region } = await this.getProjectContext(params.projectId, params.region);

    const entries: SecretListEntry[] = [];
    let nextToken: string | undefined;
    do {
      const response = await this.callAws(() =>
        client.send(
          new ListSecretsCommand({
            Filters: [{ Key: "tag-key", Values: [MANAGED_TAG_KEY] }],
            MaxResults: LIST_PAGE_SIZE,
            NextToken: nextToken,
          }),
        ),
      );
      entries.push(...(response.SecretList ?? []));
      nextToken = response.NextToken;
    } while (nextToken);

    const start = params.page * params.pageSize;
    const records = entries.slice(start, start + params.pageSize).map((entry) => this.toSecretResponse(entry, region));
    return {
      pagination: {
        countOfCurrentPage: records.length,
        countOfTotal: entries.length,
        page: params.page,
        pageSize: params.pageSize,
      },
      records,
    };
  }

  async getSecret(projectId: string, name: string, region?: string) {
    const { client, region: resolvedRegion } = await this.getProjectContext(projectId, region);
    const entry = await this.callAws(() => client.send(new DescribeSecretCommand({ SecretId: name })));
    return this.toSecretResponse(entry, resolvedRegion);
  }

  async getSecretValue(projectId: string, name: string, region?: string) {
    const { client } = await this.getProjectContext(projectId, region);
    const response = await this.callAws(() =>
      client.send(new GetSecretValueCommand({ SecretId: name, VersionStage: "AWSCURRENT" })),
    );
    const raw =
      response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString("utf-8") : "{}");

    let secretValue: Record<string, any>;
    try {
      secretValue = JSON.parse(raw);
    } catch {
      throw new BadRequestException("Secret value is not valid JSON");
    }

    // Value reads are the most sensitive operation of this plane; audit them via
    // the log sink until a dedicated audit trail is wired.
    this.logger.log(`Secret value read: project=${projectId} name=${name}`);
    return { name, secretValue };
  }

  async createSecret(params: {
    projectId: string;
    name: string;
    type: SecretType;
    description?: string;
    secretValue: Record<string, any>;
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
          SecretString: JSON.stringify(params.secretValue),
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
    data: { secretValue?: Record<string, any>; description?: string; type?: SecretType; region?: string },
  ) {
    const { client, region } = await this.getProjectContext(projectId, data.region);

    if (data.secretValue !== undefined || data.description !== undefined) {
      await this.callAws(() =>
        client.send(
          new UpdateSecretCommand({
            SecretId: name,
            ...(data.secretValue !== undefined ? { SecretString: JSON.stringify(data.secretValue) } : {}),
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

  private async getProjectContext(projectId: string, region?: string): Promise<ProjectContext> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    const resolvedRegion = region ?? credential.defaultRegion;
    const cacheKey = `${projectId}:${resolvedRegion}:${credential.accessKeyId}`;
    let client = this.clientCache.get(cacheKey);
    if (!client) {
      client = new SecretsManagerClient({
        region: resolvedRegion,
        credentials: {
          accessKeyId: credential.accessKeyId,
          secretAccessKey: credential.secretAccessKey,
        },
      });
      this.clientCache.set(cacheKey, client);
    }
    return { client, region: resolvedRegion };
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

  /** Map AWS SDK errors onto HTTP semantics without leaking raw AWS messages. */
  private toHttpException(error: unknown): HttpException {
    const { name, message } = (error ?? {}) as { name?: string; message?: string };
    this.logger.warn(`AWS Secrets Manager call failed: ${name ?? "UnknownError"}: ${message ?? String(error)}`);
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
