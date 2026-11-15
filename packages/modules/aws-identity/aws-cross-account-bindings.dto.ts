import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

const AWS_REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const IAM_ROLE_ARN_PATTERN = /^arn:aws(-gov|-cn)?:iam::\d{12}:role\/[\w+=,.@/-]+$/;
const LAMBDA_FUNCTION_ARN_PATTERN =
  /^arn:aws(-gov|-cn)?:lambda:[a-z]{2}(-gov)?-[a-z]+-\d:\d{12}:function:[\w+=,.@/-]+$/;
const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

/**
 * Non-sensitive cross-account binding fields returned to the client.
 * The external ID is not a secret: it only protects the customer's trust
 * policy against the confused-deputy problem and is safe to display.
 */
export class AwsCrossAccountBindingDto {
  @ApiProperty({ description: "Binding record ID" })
  id!: string;

  @ApiProperty({ description: "Customer AWS account ID this binding grants access to" })
  accountId!: string;

  @ApiPropertyOptional({
    description: "Platform-side display name entered by the operator; null when the account is unnamed",
    type: String,
  })
  name?: string | null;

  @ApiPropertyOptional({
    description: "Customer-managed IAM role ARN assumed via STS; null until setup is completed",
    type: String,
  })
  roleArn?: string | null;

  @ApiProperty({ description: "External ID required by the role trust policy" })
  externalId!: string;

  @ApiPropertyOptional({
    description:
      "External ID of the candidate identity while a rebind is in progress; the active identity keeps serving until it is replaced",
    type: String,
  })
  pendingExternalId?: string | null;

  @ApiPropertyOptional({ description: "Customer IAM role name resolved via STS after assuming the role", type: String })
  roleName?: string | null;

  @ApiPropertyOptional({
    description: "ARN of the rotation Lambda deployed in this account; null until it is provisioned",
    type: String,
  })
  rotationLambdaArn?: string | null;

  @ApiPropertyOptional({ description: "Default AWS region for API calls", type: String })
  defaultRegion?: string | null;

  @ApiProperty({ type: String, isArray: true, description: "Configured AWS regions" })
  regions!: string[];

  @ApiPropertyOptional({ description: "Last verification timestamp (ISO)", type: String })
  lastVerifiedAt?: string | null;

  @ApiProperty({ description: "Last update timestamp (ISO)" })
  updatedAt!: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: "Consumer IDs referencing this account; present in the account list response",
  })
  consumerIds?: string[];
}

/**
 * Response envelope for account-scoped endpoints.
 * `configured` is true only after a role ARN has been saved and verified.
 * `defaultAccountId` is the host default account, used to render the
 * Principal of the customer-facing role trust policy.
 */
export class AwsCrossAccountBindingResponseDto {
  @ApiProperty({ description: "Customer AWS account ID" })
  accountId!: string;

  @ApiProperty({ description: "Whether a cross-account role is fully configured for this account" })
  configured!: boolean;

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
 * Response envelope for the account list. `defaultAccountId` is the host
 * default account, shared by every row, so the client fetches it once.
 */
export class AwsCrossAccountBindingListResponseDto {
  @ApiProperty({ type: AwsCrossAccountBindingDto, isArray: true })
  accounts!: AwsCrossAccountBindingDto[];

  @ApiPropertyOptional({
    description: "Host default AWS account ID resolved via the SDK default credential chain",
    type: String,
  })
  defaultAccountId?: string | null;
}

/**
 * Response envelope for consumer-scoped endpoints. A consumer (project id /
 * tenant id / ...) either references one account binding or nothing at all;
 * `credential` carries the referenced binding so a consumer page can render
 * the full account card without a second lookup.
 */
export class AwsCrossAccountBindingConsumerResponseDto {
  @ApiProperty({ description: "Consumer ID (project id / tenant id / ...)" })
  consumerId!: string;

  @ApiPropertyOptional({ description: "Customer AWS account ID this consumer references", type: String })
  accountId?: string | null;

  @ApiProperty({ description: "Whether the referenced account has a fully configured role" })
  configured!: boolean;

  @ApiPropertyOptional({
    description: "Binding details of the referenced account, or null when nothing is attached",
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
  verification!: AwsCrossAccountBindingVerificationDto;
}

export class UpsertAwsCrossAccountBindingDto {
  @ApiPropertyOptional({
    description: "Platform-side display name for the account; omit to keep the stored name, null or blank to clear it",
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiProperty({ description: "Customer-managed IAM role ARN to assume" })
  @IsNotEmpty()
  @IsString()
  @Matches(IAM_ROLE_ARN_PATTERN, { message: "roleArn must be a valid IAM role ARN" })
  roleArn!: string;

  @ApiPropertyOptional({
    description: "Optional default region. If omitted, falls back to the first region in regions[].",
  })
  @IsOptional()
  @IsString()
  @Matches(AWS_REGION_PATTERN)
  defaultRegion?: string;

  @ApiPropertyOptional({ type: String, isArray: true, example: ["us-east-1", "ap-southeast-1"] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(AWS_REGION_PATTERN, { each: true })
  regions?: string[];

  @ApiPropertyOptional({
    description: "ARN of the rotation Lambda deployed in this account; omit to keep, null to clear",
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Matches(LAMBDA_FUNCTION_ARN_PATTERN, { message: "rotationLambdaArn must be a valid Lambda function ARN" })
  rotationLambdaArn?: string | null;
}

/**
 * Rename an account. The name is display-only metadata: it is never part of
 * the identity exchange or the region scope, so an account whose role is not
 * configured yet can still be named. Null or blank clears the name.
 */
export class UpdateAwsCrossAccountBindingNameDto {
  @ApiPropertyOptional({
    description: "Platform-side display name for the account; null or blank clears it",
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  name?: string | null;
}

/**
 * Attach (or move) a consumer to an account binding. The account must already
 * be bootstrapped; attaching an unknown account is rejected so a typo cannot
 * create a dangling reference.
 */
export class AttachAwsCrossAccountBindingConsumerDto {
  @ApiProperty({ description: "Customer AWS account ID whose binding this consumer references" })
  @IsNotEmpty()
  @IsString()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account ID" })
  accountId!: string;
}
