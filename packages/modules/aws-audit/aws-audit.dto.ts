import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsOptional, IsString} from 'class-validator';

/** Scan lifecycle status. */
export type AwsAuditScanStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/** Finding severity level. */
export type AwsAuditSeverity = 'high' | 'medium' | 'low';

/** Aggregated scan summary counts. */
export class AwsAuditScanSummaryDto {
  @ApiProperty({type: [String], description: 'AWS regions scanned'})
  regionsScanned: string[];

  @ApiProperty({description: 'Total number of security findings'})
  totalFindings: number;

  @ApiProperty({description: 'High-severity findings count'})
  high: number;

  @ApiProperty({description: 'Medium-severity findings count'})
  medium: number;

  @ApiProperty({description: 'Low-severity findings count'})
  low: number;

  @ApiProperty({description: 'Number of services that partially failed during the scan'})
  partialFailures: number;
}

/** A single persisted audit scan record (serialized for the client). */
export class AwsAuditScanRecordDto {
  @ApiProperty({description: 'Scan record ID'})
  id: string;

  @ApiProperty({description: 'Project ID'})
  projectId: string;

  @ApiProperty({description: 'Scan lifecycle status', example: 'SUCCESS'})
  status: AwsAuditScanStatus;

  @ApiPropertyOptional({description: 'Error message when status is FAILED', type: String})
  errorMessage?: string | null;

  @ApiPropertyOptional({
    description: 'Aggregated summary counts, null until scan completes',
    type: AwsAuditScanSummaryDto,
  })
  summary?: AwsAuditScanSummaryDto | null;

  @ApiProperty({description: 'Whether a full report is available for this scan'})
  hasReport: boolean;

  @ApiProperty({description: 'Creation timestamp (ISO)'})
  createdAt: string;

  @ApiProperty({description: 'Last update timestamp (ISO)'})
  updatedAt: string;

  @ApiPropertyOptional({description: 'Timestamp when the scan started (ISO)', type: String})
  startedAt?: string | null;

  @ApiPropertyOptional({description: 'Timestamp when the scan finished (ISO)', type: String})
  finishedAt?: string | null;
}

/** AWS account identity info resolved during the scan. */
export class AwsAuditAccountDto {
  @ApiProperty({description: 'Project name'})
  projectName: string;

  @ApiProperty({description: 'AWS account ID from the configured credential'})
  configuredAwsAccountId: string;

  @ApiPropertyOptional({description: 'AWS account ID discovered via STS', type: String})
  discoveredAwsAccountId?: string | null;

  @ApiPropertyOptional({description: 'IAM user name from STS or credential', type: String})
  iamUserName?: string | null;

  @ApiPropertyOptional({description: 'Caller ARN from STS', type: String})
  callerArn?: string | null;

  @ApiProperty({description: 'AWS access key ID used for the scan'})
  accessKeyId: string;

  @ApiProperty({type: [String], description: 'AWS regions scanned'})
  regions: string[];
}

/** A single security finding from the audit. */
export class AwsAuditFindingDto {
  @ApiProperty({description: 'AWS service that produced the finding'})
  service: 'iam' | 's3' | 'ec2' | 'rds' | 'sts';

  @ApiProperty({description: 'Severity level'})
  severity: AwsAuditSeverity;

  @ApiProperty({description: 'Type of resource (e.g. IAMUser, S3Bucket)'})
  resourceType: string;

  @ApiProperty({description: 'Resource identifier'})
  resourceId: string;

  @ApiProperty({description: 'Short finding title'})
  title: string;

  @ApiProperty({description: 'Detailed finding description'})
  detail: string;

  @ApiPropertyOptional({description: 'Recommended remediation'})
  recommendation?: string;

  @ApiPropertyOptional({description: 'AWS region where the resource resides', type: String})
  region?: string | null;
}

/** A partial-failure error recorded during the scan. */
export class AwsAuditErrorDto {
  @ApiProperty({description: 'AWS service that failed'})
  service: 'iam' | 's3' | 'ec2' | 'rds' | 'sts';

  @ApiProperty({description: 'Error message'})
  message: string;
}

/** IAM user access key metadata from the credential report. */
export class AwsAuditIamAccessKeyDto {
  @ApiProperty({description: 'Access key slot (1 or 2)'})
  slot: number;

  @ApiProperty({description: 'Whether the access key is active'})
  active: boolean;

  @ApiPropertyOptional({description: 'Last rotation timestamp (ISO)', type: String})
  lastRotatedAt?: string | null;

  @ApiPropertyOptional({description: 'Last usage timestamp (ISO)', type: String})
  lastUsedAt?: string | null;

  @ApiPropertyOptional({description: 'Last usage region', type: String})
  lastUsedRegion?: string | null;

  @ApiPropertyOptional({description: 'Last usage service', type: String})
  lastUsedService?: string | null;
}

/** A managed or inline policy risk item. */
export class AwsAuditPolicyRiskDto {
  @ApiProperty({description: 'Severity level'})
  severity: AwsAuditSeverity;

  @ApiProperty({description: 'Short risk summary'})
  summary: string;

  @ApiProperty({description: 'Detailed risk description'})
  detail: string;
}

/** An attached or inline policy with associated risks. */
export class AwsAuditPolicyAnalysisDto {
  @ApiProperty({description: 'Policy name'})
  policyName: string;

  @ApiProperty({description: 'Policy ARN (or inline identifier)'})
  policyArn: string;

  @ApiProperty({type: [AwsAuditPolicyRiskDto], description: 'Risk findings for this policy'})
  risks: AwsAuditPolicyRiskDto[];
}

/** An IAM user with MFA status, attached policies, and access keys. */
export class AwsAuditIamUserDto {
  @ApiProperty({description: 'IAM user name'})
  userName: string;

  @ApiPropertyOptional({description: 'IAM user ARN', type: String})
  arn?: string | null;

  @ApiPropertyOptional({description: 'User creation timestamp (ISO)', type: String})
  createdAt?: string | null;

  @ApiProperty({description: 'Whether console password is enabled'})
  passwordEnabled: boolean;

  @ApiPropertyOptional({description: 'Last password change timestamp (ISO)', type: String})
  passwordLastChanged?: string | null;

  @ApiPropertyOptional({description: 'Next password rotation timestamp (ISO)', type: String})
  passwordNextRotation?: string | null;

  @ApiProperty({description: 'Whether MFA is enabled'})
  mfaActive: boolean;

  @ApiProperty({type: [String], description: 'Groups the user belongs to'})
  groups: string[];

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Attached managed policies with risks'})
  attachedPolicies: AwsAuditPolicyAnalysisDto[];

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Inline policies with risks'})
  inlinePolicies: AwsAuditPolicyAnalysisDto[];

  @ApiProperty({type: [AwsAuditIamAccessKeyDto], description: 'Access key metadata from credential report'})
  accessKeys: AwsAuditIamAccessKeyDto[];
}

/** An IAM group with attached and inline policies. */
export class AwsAuditIamGroupDto {
  @ApiProperty({description: 'IAM group name'})
  groupName: string;

  @ApiPropertyOptional({description: 'IAM group ARN', type: String})
  arn?: string | null;

  @ApiPropertyOptional({description: 'Group creation timestamp (ISO)', type: String})
  createdAt?: string | null;

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Attached managed policies with risks'})
  attachedPolicies: AwsAuditPolicyAnalysisDto[];

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Inline policies with risks'})
  inlinePolicies: AwsAuditPolicyAnalysisDto[];
}

/** An IAM role with attached and inline policies. */
export class AwsAuditIamRoleDto {
  @ApiProperty({description: 'IAM role name'})
  roleName: string;

  @ApiPropertyOptional({description: 'IAM role ARN', type: String})
  arn?: string | null;

  @ApiPropertyOptional({description: 'Role creation timestamp (ISO)', type: String})
  createdAt?: string | null;

  @ApiPropertyOptional({description: 'Last usage timestamp (ISO)', type: String})
  lastUsedAt?: string | null;

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Attached managed policies with risks'})
  attachedPolicies: AwsAuditPolicyAnalysisDto[];

  @ApiProperty({type: [AwsAuditPolicyAnalysisDto], description: 'Inline policies with risks'})
  inlinePolicies: AwsAuditPolicyAnalysisDto[];
}

/** IAM account password policy. */
export class AwsAuditPasswordPolicyDto {
  @ApiProperty({description: 'Minimum password length'})
  minimumPasswordLength: number;

  @ApiProperty({description: 'Whether symbols are required'})
  requireSymbols: boolean;

  @ApiProperty({description: 'Whether numbers are required'})
  requireNumbers: boolean;

  @ApiProperty({description: 'Whether uppercase characters are required'})
  requireUppercaseCharacters: boolean;

  @ApiProperty({description: 'Whether lowercase characters are required'})
  requireLowercaseCharacters: boolean;

  @ApiProperty({description: 'Whether users can change their own password'})
  allowUsersToChangePassword: boolean;

  @ApiProperty({description: 'Whether password expiration is enforced'})
  expirePasswords: boolean;

  @ApiPropertyOptional({description: 'Maximum password age in days', type: Number})
  maxPasswordAge?: number | null;

  @ApiPropertyOptional({description: 'Password reuse prevention count', type: Number})
  passwordReusePrevention?: number | null;

  @ApiProperty({description: 'Whether hard expiry is enabled'})
  hardExpiry: boolean;
}

/** IAM resources captured during the scan. */
export class AwsAuditIamResourcesDto {
  @ApiPropertyOptional({
    description: 'Account password policy, or null if none set',
    type: AwsAuditPasswordPolicyDto,
  })
  passwordPolicy?: AwsAuditPasswordPolicyDto | null;

  @ApiProperty({type: [AwsAuditIamUserDto]})
  users: AwsAuditIamUserDto[];

  @ApiProperty({type: [AwsAuditIamGroupDto]})
  groups: AwsAuditIamGroupDto[];

  @ApiProperty({type: [AwsAuditIamRoleDto]})
  roles: AwsAuditIamRoleDto[];
}

/** An S3 bucket with security-relevant settings. */
export class AwsAuditS3BucketDto {
  @ApiProperty({description: 'Bucket name'})
  name: string;

  @ApiPropertyOptional({description: 'Bucket ARN', type: String})
  arn?: string | null;

  @ApiProperty({description: 'Bucket region'})
  region: string;

  @ApiPropertyOptional({description: 'Bucket creation timestamp (ISO)', type: String})
  createdAt?: string | null;

  @ApiPropertyOptional({description: 'Public Access Block configuration (raw AWS response)', type: Object})
  publicAccessBlock?: Record<string, unknown> | null;

  @ApiProperty({description: 'Whether the bucket policy is evaluated as public'})
  policyIsPublic: boolean;

  @ApiProperty({description: 'Whether the bucket has public ACL grants'})
  hasPublicAcl: boolean;

  @ApiProperty({description: 'Whether default encryption is enabled'})
  encryptionEnabled: boolean;

  @ApiProperty({description: 'Versioning status (Enabled/Suspended/Disabled)'})
  versioningStatus: string;
}

/** An EC2 instance. */
export class AwsAuditEc2InstanceDto {
  @ApiPropertyOptional({description: 'Instance ID', type: String})
  instanceId?: string | null;

  @ApiProperty({description: 'Instance name tag'})
  name: string;

  @ApiPropertyOptional({description: 'Instance state', type: String})
  state?: string | null;

  @ApiPropertyOptional({description: 'Instance type', type: String})
  instanceType?: string | null;

  @ApiPropertyOptional({description: 'Public IP address', type: String})
  publicIpAddress?: string | null;

  @ApiPropertyOptional({description: 'Private IP address', type: String})
  privateIpAddress?: string | null;

  @ApiProperty({type: [String], description: 'Security group IDs attached to the instance'})
  securityGroupIds: string[];
}

/** An EC2 security group ingress rule. */
export class AwsAuditIngressRuleDto {
  @ApiProperty({description: 'IP protocol'})
  protocol: string;

  @ApiPropertyOptional({description: 'From port', type: Number})
  fromPort?: number | null;

  @ApiPropertyOptional({description: 'To port', type: Number})
  toPort?: number | null;

  @ApiProperty({type: [String], description: 'IPv4 CIDR ranges'})
  ipv4Ranges: string[];

  @ApiProperty({type: [String], description: 'IPv6 CIDR ranges'})
  ipv6Ranges: string[];
}

/** An EC2 security group. */
export class AwsAuditSecurityGroupDto {
  @ApiPropertyOptional({description: 'Security group ID', type: String})
  groupId?: string | null;

  @ApiPropertyOptional({description: 'Security group name', type: String})
  groupName?: string | null;

  @ApiPropertyOptional({description: 'Description', type: String})
  description?: string | null;

  @ApiProperty({type: [AwsAuditIngressRuleDto], description: 'Ingress rules'})
  ingressRules: AwsAuditIngressRuleDto[];
}

/** EC2 resources for a single region. */
export class AwsAuditEc2RegionResourcesDto {
  @ApiProperty({type: [AwsAuditEc2InstanceDto]})
  instances: AwsAuditEc2InstanceDto[];

  @ApiProperty({type: [AwsAuditSecurityGroupDto]})
  securityGroups: AwsAuditSecurityGroupDto[];
}

/** An RDS instance. */
export class AwsAuditRdsInstanceDto {
  @ApiPropertyOptional({description: 'DB instance identifier', type: String})
  dbInstanceIdentifier?: string | null;

  @ApiPropertyOptional({description: 'RDS resource ID', type: String})
  dbiResourceId?: string | null;

  @ApiPropertyOptional({description: 'Database engine', type: String})
  engine?: string | null;

  @ApiPropertyOptional({description: 'Engine version', type: String})
  engineVersion?: string | null;

  @ApiPropertyOptional({description: 'Instance status', type: String})
  status?: string | null;

  @ApiProperty({description: 'Whether the instance is publicly accessible'})
  publiclyAccessible: boolean;

  @ApiProperty({description: 'Whether storage is encrypted'})
  storageEncrypted: boolean;

  @ApiProperty({description: 'Whether deletion protection is enabled'})
  deletionProtection: boolean;

  @ApiPropertyOptional({description: 'Master username', type: String})
  masterUsername?: string | null;

  @ApiProperty({description: 'Whether master password is managed by AWS Secrets Manager'})
  manageMasterUserPassword: boolean;

  @ApiPropertyOptional({description: 'Master user secret ARN', type: String})
  masterUserSecretArn?: string | null;

  @ApiProperty({description: 'Whether Multi-AZ is enabled'})
  multiAz: boolean;
}

/** Per-region resources (EC2 + RDS). */
export class AwsAuditRegionalResourceDto {
  @ApiProperty({description: 'AWS region'})
  region: string;

  @ApiProperty({type: AwsAuditEc2RegionResourcesDto})
  ec2: AwsAuditEc2RegionResourcesDto;

  @ApiProperty({type: [AwsAuditRdsInstanceDto]})
  rds: AwsAuditRdsInstanceDto[];
}

/** Full resource inventory captured during the scan. */
export class AwsAuditResourcesDto {
  @ApiProperty({type: AwsAuditIamResourcesDto})
  iam: AwsAuditIamResourcesDto;

  @ApiProperty({type: [AwsAuditS3BucketDto]})
  s3: AwsAuditS3BucketDto[];

  @ApiProperty({type: [AwsAuditRegionalResourceDto]})
  regional: AwsAuditRegionalResourceDto[];
}

/** The full audit report. */
export class AwsAuditReportDto {
  @ApiProperty({description: 'Project ID'})
  projectId: string;

  @ApiProperty({description: 'Scan completion timestamp (ISO)'})
  scannedAt: string;

  @ApiProperty({type: AwsAuditAccountDto})
  account: AwsAuditAccountDto;

  @ApiProperty({type: AwsAuditScanSummaryDto})
  summary: AwsAuditScanSummaryDto;

  @ApiProperty({type: [String], description: 'Known limitations of this audit'})
  limitations: string[];

  @ApiProperty({type: [AwsAuditErrorDto]})
  errors: AwsAuditErrorDto[];

  @ApiProperty({type: [AwsAuditFindingDto]})
  findings: AwsAuditFindingDto[];

  @ApiPropertyOptional({type: AwsAuditResourcesDto})
  resources?: AwsAuditResourcesDto;
}

/** Response for GET /aws-audit/projects/:projectId/report. */
export class AwsAuditReportResponseDto {
  @ApiProperty({description: 'Project ID'})
  projectId: string;

  @ApiProperty({description: 'Whether an AWS credential is configured for this project'})
  hasSettings: boolean;

  @ApiPropertyOptional({description: 'Currently running scan, or null', type: AwsAuditScanRecordDto})
  currentScan?: AwsAuditScanRecordDto | null;

  @ApiPropertyOptional({description: 'Most recent scan (any status), or null', type: AwsAuditScanRecordDto})
  latestScan?: AwsAuditScanRecordDto | null;

  @ApiPropertyOptional({description: 'Most recent successful scan, or null', type: AwsAuditScanRecordDto})
  latestSuccessfulScan?: AwsAuditScanRecordDto | null;

  @ApiPropertyOptional({description: 'Most recent failed scan, or null', type: AwsAuditScanRecordDto})
  latestFailedScan?: AwsAuditScanRecordDto | null;

  @ApiPropertyOptional({
    description: 'Full audit report, or null if no successful scan exists',
    type: AwsAuditReportDto,
  })
  report?: AwsAuditReportDto | null;
}

/** Response for POST /aws-audit/projects/:projectId/scan. */
export class AwsAuditScanStartResponseDto {
  @ApiProperty({description: 'Whether the scan request was accepted'})
  accepted: boolean;

  @ApiProperty({
    description: 'The scan record that was started (or the already-running one)',
    type: AwsAuditScanRecordDto,
  })
  scan: AwsAuditScanRecordDto;
}

export class GetAwsAuditReportDto {
  @ApiPropertyOptional({
    description: 'When true, include full resource inventory. When false, only returns summary and findings.',
    default: true,
  })
  @IsOptional()
  @IsString()
  detail?: string;
}
