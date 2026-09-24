import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches} from 'class-validator';

const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

/**
 * AWS access key status, mirrors the Prisma enum AwsAccessKeyStatus.
 */
export type AwsAccessKeyStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'ROTATING';

/**
 * Non-sensitive credential fields returned to the client.
 * The secret access key is never included.
 */
export class ProjectAwsCredentialDto {
  @ApiProperty({description: 'Credential record ID'})
  id: string;

  @ApiProperty({description: 'AWS access key ID'})
  accessKeyId: string;

  @ApiProperty({description: 'Whether a secret access key is stored (never returned in plaintext)'})
  hasSecretAccessKey: boolean;

  @ApiPropertyOptional({description: 'AWS account ID resolved via STS', type: String})
  awsAccountId?: string | null;

  @ApiPropertyOptional({description: 'IAM user name resolved via STS', type: String})
  iamUserName?: string | null;

  @ApiPropertyOptional({description: 'Default AWS region for API calls', type: String})
  defaultRegion?: string | null;

  @ApiProperty({type: [String], description: 'Configured AWS regions'})
  regions: string[];

  @ApiProperty({description: 'Access key status', example: 'ACTIVE'})
  status: AwsAccessKeyStatus;

  @ApiPropertyOptional({description: 'Last verification timestamp (ISO)', type: String})
  lastVerifiedAt?: string | null;

  @ApiProperty({description: 'Last update timestamp (ISO)'})
  updatedAt: string;
}

/**
 * Response envelope for GET / PUT / DELETE credential endpoints.
 */
export class ProjectAwsCredentialResponseDto {
  @ApiProperty({description: 'Project ID'})
  projectId: string;

  @ApiProperty({description: 'Whether an AWS credential is configured for this project'})
  configured: boolean;

  @ApiPropertyOptional({description: 'Credential details, or null when not configured', type: ProjectAwsCredentialDto})
  credential?: ProjectAwsCredentialDto | null;
}

/**
 * Additional STS caller-identity info returned by the verify endpoint.
 */
export class AwsCredentialVerificationDto {
  @ApiPropertyOptional({description: 'AWS account ID from STS GetCallerIdentity', type: String})
  accountId?: string | null;

  @ApiPropertyOptional({description: 'ARN from STS GetCallerIdentity', type: String})
  arn?: string | null;

  @ApiPropertyOptional({description: 'User ID from STS GetCallerIdentity', type: String})
  userId?: string | null;

  @ApiPropertyOptional({description: 'IAM user name from STS GetCallerIdentity', type: String})
  iamUserName?: string | null;
}

/**
 * Response for the verify endpoint: credential details plus live STS verification.
 */
export class VerifyAwsCredentialResponseDto extends ProjectAwsCredentialResponseDto {
  @ApiProperty({description: 'Live STS caller-identity verification result'})
  verification: AwsCredentialVerificationDto;
}

export class UpsertProjectAwsCredentialDto {
  @ApiProperty({description: 'AWS access key ID'})
  @IsNotEmpty()
  @IsString()
  accessKeyId: string;

  @ApiPropertyOptional({
    description: 'AWS secret access key. Optional when updating an existing credential (leave empty to keep current).',
  })
  @IsOptional()
  @IsString()
  secretAccessKey?: string;

  @ApiPropertyOptional({
    description: 'Optional default region. If omitted, falls back to the first region in regions[].',
  })
  @IsOptional()
  @IsString()
  @Matches(AWS_REGION_PATTERN)
  defaultRegion?: string;

  @ApiPropertyOptional({type: [String], example: ['us-east-1', 'ap-southeast-1']})
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({each: true})
  @Matches(AWS_REGION_PATTERN, {each: true})
  regions?: string[];
}
