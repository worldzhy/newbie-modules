import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from "@nestjs/swagger";
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

@ApiTags("AWS Secrets Manager")
@ApiBearerAuth()
@Controller("aws-secrets-manager/secrets")
export class AwsSecretsManagerController {
  constructor(private readonly secretsService: AwsSecretsManagerService) {}

  @Post("")
  @ApiOperation({ summary: "Create Secret" })
  @ApiResponse({ status: 201, description: "Secret created successfully", type: SecretResponseDto })
  async createSecret(@Body() body: CreateSecretDto) {
    return await this.secretsService.createSecret(body);
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
    @Param("name") name: string,
    @Query() query: GetSecretRequestDto,
  ): Promise<GetSecretValueResponseDto> {
    return await this.secretsService.getSecretValue(query.projectId, name, query.region);
  }

  @Patch(":name")
  @ApiOperation({ summary: "Update Secret" })
  @ApiResponse({ type: SecretResponseDto })
  async updateSecret(@Param("name") name: string, @Body() body: UpdateSecretDto) {
    return await this.secretsService.updateSecret(body.projectId, name, body);
  }

  @Delete(":name")
  @ApiOperation({ summary: "Delete Secret (30-day recovery window)" })
  @ApiResponse({ type: DeleteSecretResponseDto })
  async deleteSecret(@Param("name") name: string, @Query() query: GetSecretRequestDto) {
    return await this.secretsService.deleteSecret(query.projectId, name, query.region);
  }

  @Post(":name/rotate")
  @ApiOperation({ summary: "Trigger an immediate rotation with the existing rotation configuration" })
  @ApiResponse({ type: SecretResponseDto })
  async rotateSecret(@Param("name") name: string, @Query() query: GetSecretRequestDto) {
    return await this.secretsService.rotateSecret(query.projectId, name, query.region);
  }

  @Post(":name/rotation")
  @ApiOperation({ summary: "Enable or disable automatic rotation" })
  @ApiResponse({ type: SecretResponseDto })
  async setRotation(@Param("name") name: string, @Body() body: SetRotationRequestDto) {
    return await this.secretsService.setRotation(body.projectId, name, body);
  }
}
