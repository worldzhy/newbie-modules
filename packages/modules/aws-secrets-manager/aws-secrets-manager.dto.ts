import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsBoolean, IsObject, IsOptional, IsString, Matches, Min } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { SECRET_TYPES, SecretType } from "./aws-secrets-manager.types";

/**
 * Secret metadata mirrored from AWS Secrets Manager (the single source of truth).
 * The actual secret value is only returned by the dedicated value endpoint.
 */
export class SecretResponseDto {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  arn: string;

  @ApiPropertyOptional({ type: String })
  description?: string | null;

  @ApiPropertyOptional({ enum: SECRET_TYPES })
  type?: SecretType | null;

  @ApiProperty({ type: String })
  region: string;

  @ApiProperty({ type: Boolean })
  rotationEnabled: boolean;

  @ApiPropertyOptional({ type: String })
  rotationLambdaArn?: string | null;

  @ApiPropertyOptional({ type: Object })
  rotationRules?: object | null;

  @ApiPropertyOptional({ type: Date })
  lastRotatedAt?: Date | null;

  @ApiPropertyOptional({ type: Date })
  lastChangedAt?: Date | null;

  @ApiPropertyOptional({ type: Date })
  createdAt?: Date | null;
}

export class SecretListResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: SecretResponseDto, isArray: true })
  declare records: SecretResponseDto[];
}

export class ListSecretsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)", required: true })
  @IsString()
  projectId: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class GetSecretRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)", required: true })
  @IsString()
  projectId: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class CreateSecretDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)", required: true })
  @IsString()
  projectId: string;

  @ApiProperty({
    description: "Secret name; letters, digits and /_+=.@- excluding slash (used as URL path parameter)",
    required: true,
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_+=.@-]{1,512}$/)
  name: string;

  @ApiProperty({ enum: SECRET_TYPES, description: "Secret type", required: true })
  @IsIn(SECRET_TYPES)
  type: SecretType;

  @ApiProperty({ description: "Secret value (key-value pairs)", type: Object, required: true })
  @IsObject()
  secretValue: Record<string, any>;

  @ApiPropertyOptional({ description: "Secret description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class UpdateSecretDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)", required: true })
  @IsString()
  projectId: string;

  @ApiPropertyOptional({ description: "New secret value (key-value pairs)", type: Object })
  @IsOptional()
  @IsObject()
  secretValue?: Record<string, any>;

  @ApiPropertyOptional({ description: "New description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: SECRET_TYPES, description: "New secret type" })
  @IsOptional()
  @IsIn(SECRET_TYPES)
  type?: SecretType;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class SetRotationRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)", required: true })
  @IsString()
  projectId: string;

  @ApiProperty({ description: "Enable or disable automatic rotation", required: true })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: "Rotation interval in days (defaults to 30)", default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class GetSecretValueResponseDto {
  @ApiProperty({ description: "Secret name" })
  name: string;

  @ApiProperty({ description: "Actual secret value", type: Object })
  secretValue: Record<string, any>;
}

export class DeleteSecretResponseDto {
  @ApiProperty({ description: "Name of the deleted secret" })
  name: string;
}
