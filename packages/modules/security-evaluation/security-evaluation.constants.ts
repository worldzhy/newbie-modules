/** Subject kinds owned by this feature (ADR-022). Kebab-case, like "work". */
export const SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY = "repository";
export const SECURITY_EVALUATION_SUBJECT_KIND_CLOUD_ACCOUNT = "cloud-account";

export const SECURITY_EVALUATION_SUBJECT_KINDS = [
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
  SECURITY_EVALUATION_SUBJECT_KIND_CLOUD_ACCOUNT,
] as const;

export type SecurityEvaluationSubjectKind = (typeof SECURITY_EVALUATION_SUBJECT_KINDS)[number];

/** Criteria families. One family per judgment mechanism (ADR-022 D3). */
export const SECURITY_EVALUATION_FAMILY_DEPENDENCY = "dependency-osv";
export const SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION = "cis-aws-1.5";
export const SECURITY_EVALUATION_FAMILY_INTELLIGENCE = "threat-intel-relevance";

/**
 * The criteria versions this build ships. Criteria are code-defined and
 * published idempotently; a rule change is a new version, never an in-place
 * edit of a published one.
 */
export const SECURITY_EVALUATION_DEPENDENCY_CRITERIA_VERSION = "v1";
export const SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY = "dependency-vulnerability";

/** The first CIS criteria version this build ships (ADR-027 D3). */
export const SECURITY_EVALUATION_CLOUD_CONFIG_CRITERIA_VERSION = "v1";

/** Asset fact vocabulary. */
export const SECURITY_EVALUATION_FACT_TYPE_PACKAGE = "package";

/** Cloud configuration fact vocabulary (ADR-027 D2). */
export const SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY = "aws.iam.account-password-policy";
export const SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ROOT_CREDENTIAL = "aws.iam.root-credential";
export const SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_USER_CREDENTIAL = "aws.iam.user-credential";
export const SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY = "aws.s3.bucket-security";
export const SECURITY_EVALUATION_FACT_TYPE_AWS_RDS_INSTANCE_SECURITY = "aws.rds.instance-security";
export const SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS = "aws.ec2.security-group-ingress";

/** npm is the only ecosystem parsed in this build, matching the predecessor. */
export const SECURITY_EVALUATION_ECOSYSTEM_NPM = "npm";
export const SECURITY_EVALUATION_LOCKFILE_CANDIDATES = ["package-lock.json"];

export const SECURITY_EVALUATION_OSV_API_BASE_URL = "https://api.osv.dev";
// 500 queries per request keeps the response (which paginates around 3000
// vulnerabilities) well inside a single page.
export const SECURITY_EVALUATION_OSV_QUERY_BATCH_SIZE = 500;
export const SECURITY_EVALUATION_OSV_DETAIL_CONCURRENCY = 10;
export const SECURITY_EVALUATION_OSV_REQUEST_TIMEOUT_MS = 30_000;

/** Reported as stale when an asset has not been observed within this window. */
export const SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS = 7;

/** Trend and mean-time-to-resolve windows of the report read model. */
export const SECURITY_EVALUATION_REPORT_TREND_WEEKS = 12;

/**
 * Scheduling declarations only. The host decides the cron and the trigger
 * conditions; the module never registers a scheduler of its own.
 */
export const SECURITY_EVALUATION_SCHEDULES = [
  {
    family: SECURITY_EVALUATION_FAMILY_DEPENDENCY,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
    recommendedInterval: "daily",
  },
  {
    family: SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_CLOUD_ACCOUNT,
    recommendedInterval: "daily",
  },
  {
    family: SECURITY_EVALUATION_FAMILY_INTELLIGENCE,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
    recommendedInterval: "hourly",
  },
] as const;
