import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
import { AuditLogService, AuditResult } from "@modules/audit/audit-log.service";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreateSecretDto,
  DeleteSecretResponseDto,
  GetSecretRequestDto,
  GetSecretValueResponseDto,
  ListSecretsRequestDto,
  SecretListResponseDto,
  SecretResponseDto,
  SetRotationRequestDto,
  UpdateSecretDto,
} from "./aws-secrets-manager.dto";
import { AwsSecretsManagerService } from "./aws-secrets-manager.service";
import { SECRET_AUDIT_EVENTS, SECRET_AUDIT_RESOURCE_TYPE } from "./aws-secrets-manager.types";

@ApiTags("AWS Secrets Manager")
@ApiBearerAuth()
@Controller("aws-secrets-manager/secrets")
export class AwsSecretsManagerController {
  constructor(
    private readonly secretsService: AwsSecretsManagerService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("")
  @ApiOperation({ summary: "Create Secret" })
  @ApiResponse({ status: 201, description: "Secret created successfully", type: SecretResponseDto })
  async createSecret(@Req() request: UserRequest, @Body() body: CreateSecretDto) {
    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.CREATED,
      body.name,
      { projectId: body.projectId, region: body.region, type: body.type },
      () => this.secretsService.createSecret(body),
    );
  }

  @Get("")
  @ApiOperation({ summary: "List all managed Secrets (metadata only, no secret values)" })
  @ApiResponse({ type: SecretListResponseDto })
  async listSecrets(@Query() query: ListSecretsRequestDto) {
    return await this.secretsService.listSecrets(query);
  }

  @Get(":name")
  @ApiOperation({ summary: "Get Secret metadata (no secret value)" })
  @ApiResponse({ type: SecretResponseDto })
  async getSecret(@Param("name") name: string, @Query() query: GetSecretRequestDto) {
    return await this.secretsService.getSecret(query.projectId, name, query.region);
  }

  @Get(":name/value")
  @ApiOperation({ summary: "Get Secret value" })
  @ApiResponse({ type: GetSecretValueResponseDto, description: "Secret name and decrypted value" })
  async getSecretValue(
    @Req() request: UserRequest,
    @Param("name") name: string,
    @Query() query: GetSecretRequestDto,
  ): Promise<GetSecretValueResponseDto> {
    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.VALUE_READ,
      name,
      { projectId: query.projectId, region: query.region },
      () => this.secretsService.getSecretValue(query.projectId, name, query.region),
      (result) => ({ valueType: result.valueType }),
    );
  }

  @Patch(":name")
  @ApiOperation({ summary: "Update Secret" })
  @ApiResponse({ type: SecretResponseDto })
  async updateSecret(@Req() request: UserRequest, @Param("name") name: string, @Body() body: UpdateSecretDto) {
    // Only field names are recorded; secret values must never reach the trail.
    const changedFields = [
      body.secretValue !== undefined ? "secretValue" : null,
      body.description !== undefined ? "description" : null,
      body.type !== undefined ? "type" : null,
    ].filter((field): field is string => field !== null);

    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.UPDATED,
      name,
      { projectId: body.projectId, region: body.region, changedFields },
      () => this.secretsService.updateSecret(body.projectId, name, body),
    );
  }

  @Delete(":name")
  @ApiOperation({ summary: "Delete Secret (30-day recovery window)" })
  @ApiResponse({ type: DeleteSecretResponseDto })
  async deleteSecret(@Req() request: UserRequest, @Param("name") name: string, @Query() query: GetSecretRequestDto) {
    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.DELETED,
      name,
      { projectId: query.projectId, region: query.region },
      () => this.secretsService.deleteSecret(query.projectId, name, query.region),
    );
  }

  @Post(":name/rotate")
  @ApiOperation({ summary: "Trigger an immediate rotation with the existing rotation configuration" })
  @ApiResponse({ type: SecretResponseDto })
  async rotateSecret(@Req() request: UserRequest, @Param("name") name: string, @Query() query: GetSecretRequestDto) {
    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.ROTATED,
      name,
      { projectId: query.projectId, region: query.region },
      () => this.secretsService.rotateSecret(query.projectId, name, query.region),
    );
  }

  @Post(":name/rotation")
  @ApiOperation({ summary: "Enable or disable automatic rotation" })
  @ApiResponse({ type: SecretResponseDto })
  async setRotation(@Req() request: UserRequest, @Param("name") name: string, @Body() body: SetRotationRequestDto) {
    return await this.runWithAudit(
      request,
      SECRET_AUDIT_EVENTS.ROTATION_CONFIGURED,
      name,
      {
        projectId: body.projectId,
        region: body.region,
        enabled: body.enabled,
        ...(body.days !== undefined ? { days: body.days } : {}),
      },
      () => this.secretsService.setRotation(body.projectId, name, body),
    );
  }

  /**
   * Run a service operation and write one business audit row for either
   * outcome. The audit write never breaks the primary flow (record() swallows
   * its own errors); failure rows carry only the mapped, non-sensitive message
   * and HTTP status, never the raw AWS error text and never secret values.
   */
  private async runWithAudit<T>(
    request: UserRequest,
    event: string,
    secretName: string,
    baseDetail: Record<string, unknown>,
    operation: () => Promise<T>,
    buildSuccessDetail?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const commonParams = {
      actorId: request.user.userId,
      resourceType: SECRET_AUDIT_RESOURCE_TYPE,
      resourceId: secretName,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    };

    try {
      const result = await operation();
      await this.auditLogService.record(event, {
        ...commonParams,
        result: AuditResult.SUCCESS,
        detail: { ...baseDetail, ...(buildSuccessDetail?.(result) ?? {}) },
      });
      return result;
    } catch (error) {
      await this.auditLogService.record(event, {
        ...commonParams,
        result: AuditResult.FAILURE,
        detail: { ...baseDetail, ...this.describeError(error) },
      });
      throw error;
    }
  }

  /** Extract a safe, already-mapped message and status for failure detail. */
  private describeError(error: unknown): { reason: string; statusCode: number } {
    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      const response = error.getResponse();
      let reason = error.message;
      if (typeof response === "string") {
        reason = response;
      } else if (response && typeof response === "object") {
        const message = (response as { message?: string | string[] }).message;
        if (Array.isArray(message)) {
          reason = message.join("; ");
        } else if (typeof message === "string") {
          reason = message;
        }
      }
      return { reason, statusCode };
    }
    return { reason: "Internal server error", statusCode: 500 };
  }
}
