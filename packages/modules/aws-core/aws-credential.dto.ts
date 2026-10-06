import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const IAM_ROLE_ARN_PATTERN = /^arn:aws(-gov|-cn)?:iam::\d{12}:role\/[\w+=,.@/-]+$/;

/**
 * Non-sensitive cross-account role fields returned to the client.
 * The external ID is not a secret: it only protects the customer's trust
 * policy against the confused-deputy problem and is safe to display.
 */
export class ProjectAwsCredentialDto {
  @ApiProperty({ description: "Credential record ID" })
  id: string;

  @ApiPropertyOptional({
    description: "Customer-managed IAM role ARN assumed via STS; null until setup is completed",
    type: String,
  })
  roleArn?: string | null;

  @ApiProperty({ description: "Per-project external ID required by the role trust policy" })
  externalId: string;

  @ApiPropertyOptional({ description: "AWS account ID resolved via STS after assuming the role", type: String })
  awsAccountId?: string | null;

  @ApiPropertyOptional({ description: "IAM role name resolved via STS", type: String })
  iamUserName?: string | null;

  @ApiPropertyOptional({ description: "Default AWS region for API calls", type: String })
  defaultRegion?: string | null;

  @ApiProperty({ type: [String], description: "Configured AWS regions" })
  regions: string[];

  @ApiPropertyOptional({ description: "Last verification timestamp (ISO)", type: String })
  lastVerifiedAt?: string | null;

  @ApiProperty({ description: "Last update timestamp (ISO)" })
  updatedAt: string;
}

/**
 * Response envelope for GET / PUT / DELETE / bootstrap / rotate endpoints.
 * `configured` is true only after a role ARN has been saved and verified.
 * `platformAccountId` is the platform's own account, used to render the
 * Principal of the customer-facing role trust policy.
 */
export class ProjectAwsCredentialResponseDto {
  @ApiProperty({ description: "Project ID" })
  projectId: string;

  @ApiProperty({ description: "Whether a cross-account role is fully configured for this project" })
  configured: boolean;

  @ApiPropertyOptional({
    description: "Credential details, or null when bootstrap has not run",
    type: ProjectAwsCredentialDto,
  })
  credential?: ProjectAwsCredentialDto | null;

  @ApiPropertyOptional({
    description: "Platform AWS account ID resolved via the SDK default credential chain",
    type: String,
  })
  platformAccountId?: string | null;
}

/**
 * Additional STS caller-identity info returned by the verify endpoint.
 */
export class AwsCredentialVerificationDto {
  @ApiPropertyOptional({ description: "AWS account ID from STS GetCallerIdentity", type: String })
  accountId?: string | null;

  @ApiPropertyOptional({ description: "Assumed-role ARN from STS GetCallerIdentity", type: String })
  arn?: string | null;

  @ApiPropertyOptional({ description: "User ID from STS GetCallerIdentity", type: String })
  userId?: string | null;

  @ApiPropertyOptional({ description: "IAM role name from STS GetCallerIdentity", type: String })
  iamUserName?: string | null;
}

/**
 * Response for the verify endpoint: credential details plus live STS verification.
 */
export class VerifyAwsCredentialResponseDto extends ProjectAwsCredentialResponseDto {
  @ApiProperty({ description: "Live STS caller-identity verification result" })
  verification: AwsCredentialVerificationDto;
}

export class UpsertProjectAwsCredentialDto {
  @ApiProperty({ description: "Customer-managed IAM role ARN to assume" })
  @IsNotEmpty()
  @IsString()
  @Matches(IAM_ROLE_ARN_PATTERN, { message: "roleArn must be a valid IAM role ARN" })
  roleArn: string;

  @ApiPropertyOptional({
    description: "Optional default region. If omitted, falls back to the first region in regions[].",
  })
  @IsOptional()
  @IsString()
  @Matches(AWS_REGION_PATTERN)
  defaultRegion?: string;

  @ApiPropertyOptional({ type: [String], example: ["us-east-1", "ap-southeast-1"] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(AWS_REGION_PATTERN, { each: true })
  regions?: string[];
}
