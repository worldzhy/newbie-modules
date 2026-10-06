import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const IAM_ROLE_ARN_PATTERN = /^arn:aws(-gov|-cn)?:iam::\d{12}:role\/[\w+=,.@/-]+$/;

/**
 * Non-sensitive cross-account binding fields returned to the client.
 * The external ID is not a secret: it only protects the customer's trust
 * policy against the confused-deputy problem and is safe to display.
 */
export class AwsCrossAccountBindingDto {
  @ApiProperty({ description: "Binding record ID" })
  id: string;

  @ApiPropertyOptional({
    description: "Customer-managed IAM role ARN assumed via STS; null until setup is completed",
    type: String,
  })
  roleArn?: string | null;

  @ApiProperty({ description: "Per-binding external ID required by the role trust policy" })
  externalId: string;

  @ApiPropertyOptional({ description: "Customer AWS account ID resolved via STS after assuming the role", type: String })
  awsAccountId?: string | null;

  @ApiPropertyOptional({ description: "Customer IAM role name resolved via STS after assuming the role", type: String })
  roleName?: string | null;

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
 * `defaultAccountId` is the host default account, used to render the
 * Principal of the customer-facing role trust policy.
 */
export class AwsCrossAccountBindingResponseDto {
  @ApiProperty({ description: "Host scope ID (project id / tenant id / ...)" })
  projectId: string;

  @ApiProperty({ description: "Whether a cross-account role is fully configured for this host scope" })
  configured: boolean;

  @ApiPropertyOptional({
    description: "Binding details, or null when bootstrap has not run",
    type: AwsCrossAccountBindingDto,
  })
  credential?: AwsCrossAccountBindingDto | null;

  @ApiPropertyOptional({
    description: "Host default AWS account ID resolved via the SDK default credential chain",
    type: String,
  })
  defaultAccountId?: string | null;
}

/**
 * Additional STS caller-identity info returned by the verify endpoint.
 * These fields are the raw GetCallerIdentity result; iamUserName carries a
 * user name, "root", or an assumed-role name depending on the principal.
 */
export class AwsCrossAccountBindingVerificationDto {
  @ApiPropertyOptional({ description: "AWS account ID from STS GetCallerIdentity", type: String })
  accountId?: string | null;

  @ApiPropertyOptional({ description: "Assumed-role ARN from STS GetCallerIdentity", type: String })
  arn?: string | null;

  @ApiPropertyOptional({ description: "User ID from STS GetCallerIdentity", type: String })
  userId?: string | null;

  @ApiPropertyOptional({ description: "Principal name from STS GetCallerIdentity (user / root / role)", type: String })
  iamUserName?: string | null;
}

/**
 * Response for the verify endpoint: binding details plus live STS verification.
 */
export class VerifyAwsCrossAccountBindingResponseDto extends AwsCrossAccountBindingResponseDto {
  @ApiProperty({ description: "Live STS caller-identity verification result" })
  verification: AwsCrossAccountBindingVerificationDto;
}

export class UpsertAwsCrossAccountBindingDto {
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
