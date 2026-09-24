import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsString, IsOptional, IsEnum, IsBoolean, IsObject, ValidateIf} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {SecretType} from '@generated/prisma/client';

/**
 * Response DTO for Secret metadata (no secret value).
 * The actual secret value is only returned by the dedicated 'getSecretValue' endpoint.
 */
export class SecretResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiPropertyOptional({type: String})
  description?: string | null;

  @ApiProperty({enum: SecretType})
  type: SecretType;

  @ApiProperty({type: String})
  arn: string;

  @ApiProperty({type: String})
  region: string;

  @ApiProperty({type: Boolean})
  rotationEnabled: boolean;

  @ApiPropertyOptional({type: Object})
  rotationRules?: object | null;

  @ApiPropertyOptional({type: String})
  rotationLambdaArn?: string | null;

  @ApiPropertyOptional({type: Date})
  lastRotatedAt?: Date | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: String})
  groupId: string;
}

/**
 * Paginated list response for secrets (metadata only).
 */
export class SecretListResponseDto extends CommonListResponseDto {
  @ApiProperty({type: SecretResponseDto, isArray: true})
  declare records: SecretResponseDto[];
}

export class ListSecretsRequestDto extends CommonListRequestDto {
  @ApiProperty({description: 'Project ID for filtering', required: true})
  @IsString()
  projectId: string;
}

export class ListSecretsResponseDto extends CommonListResponseDto {}

export class CreateSecretDto {
  @ApiProperty({description: 'Secret name (unique identifier)', required: true})
  @IsString()
  name: string;

  @ApiProperty({description: 'Secret description', required: false})
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({enum: SecretType, description: 'Secret type', required: true})
  @IsEnum(SecretType)
  type: SecretType;

  @ApiProperty({description: 'Secret value (key-value pairs)', type: Object, required: true})
  @IsObject()
  secretValue: Record<string, any>;

  @ApiProperty({description: 'AWS Region (defaults to region in configuration)', required: false})
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({
    description: 'Enable automatic rotation (only for RDS_CREDENTIALS/DOCUMENTDB_CREDENTIALS/AWS_API_KEY)',
    default: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  rotationEnabled?: boolean;

  @ApiProperty({
    description: 'Rotation rules configuration',
    type: Object,
    required: false,
    example: {AutomaticallyAfterDays: 30},
  })
  @IsOptional()
  @IsObject()
  @ValidateIf(o => o.rotationEnabled === true)
  rotationRules?: {AutomaticallyAfterDays: number};

  @ApiProperty({description: 'Project ID', required: true})
  @IsString()
  projectId: string;
}

export class UpdateSecretDto {
  @ApiProperty({description: 'Update Secret value', type: Object, required: false})
  @IsOptional()
  @IsObject()
  secretValue?: Record<string, any>;

  @ApiProperty({description: 'Update description', required: false})
  @IsOptional()
  @IsString()
  description?: string;
}

export class GetSecretValueResponseDto {
  @ApiProperty({description: 'Secret ID'})
  id: string;

  @ApiProperty({description: 'Secret name'})
  name: string;

  @ApiProperty({enum: SecretType, description: 'Secret type'})
  type: SecretType;

  @ApiProperty({description: 'Actual secret value', type: Object})
  secretValue: Record<string, any>;

  @ApiProperty({description: 'Description', required: false})
  description?: string | null;

  @ApiProperty({description: 'AWS Secret ARN'})
  arn: string;

  @ApiProperty({description: 'AWS Region'})
  region: string;

  @ApiProperty({description: 'Enable automatic rotation'})
  rotationEnabled: boolean;

  @ApiProperty({description: 'Lambda ARN', required: false})
  rotationLambdaArn?: string | null;

  @ApiProperty({description: 'Rotation rules', required: false})
  rotationRules?: any;

  @ApiProperty({description: 'Last rotation timestamp', required: false})
  lastRotatedAt?: Date | null;

  @ApiProperty({description: 'Created at'})
  createdAt: Date;

  @ApiProperty({description: 'Updated at'})
  updatedAt: Date;
}

export class DeployRotationLambdaDto {
  @ApiProperty({description: 'Project ID where to deploy Lambda', required: true})
  @IsString()
  projectId: string;
}
