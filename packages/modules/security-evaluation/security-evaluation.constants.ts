/** Feature key this module registers subjects under (ADR-069). */
export const SECURITY_EVALUATION_SUBJECT_TYPE = "security-evaluation";

/** Subject kinds owned by this feature (ADR-022). Kebab-case, like "work". */
export const SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY = "repository";
export const SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT = "aws-account";
export const SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN = "web-origin";

export const SECURITY_EVALUATION_SUBJECT_KINDS = [
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
] as const;

export type SecurityEvaluationSubjectKind = (typeof SECURITY_EVALUATION_SUBJECT_KINDS)[number];

/**
 * Path roles a rule may target on a web origin (ADR-066 §1). Rules never embed
 * URLs: they declare the semantic slot they need, and the asset owns the
 * "role → relative path" map, so a ruleset change never forks per asset and an
 * unconfigured role simply skips the criterion.
 */
export const SECURITY_EVALUATION_WEB_ORIGIN_PATH_ROLES = ["auth.login", "api.session"] as const;

export type SecurityEvaluationWebOriginPathRole = (typeof SECURITY_EVALUATION_WEB_ORIGIN_PATH_ROLES)[number];

/** Ownership-verification states of a web-origin asset (ADR-044 §2). */
export const SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "REVOKED",
] as const;

export type SecurityEvaluationWebOriginVerificationStatus =
  (typeof SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES)[number];

/** How a host proves it controls an origin (ADR-044 §2). */
export const SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS = ["DNS_TXT", "WELL_KNOWN"] as const;

export type SecurityEvaluationWebOriginVerificationMethod =
  (typeof SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS)[number];

/** Protocol constants of the two verification channels. */
export const SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_NAME_PREFIX = "_nightwatch-verify";
export const SECURITY_EVALUATION_WEB_ORIGIN_DNS_TXT_VALUE_PREFIX = "nightwatch-verify=";
export const SECURITY_EVALUATION_WEB_ORIGIN_WELL_KNOWN_PATH = "/.well-known/nightwatch-verification.txt";

/**
 * Ownership re-verification policy (ADR-044). Policy values, identical in every
 * deployment, so they are code constants rather than manifest env keys
 * (ADR-053): re-verify lazily after this many days, drop an origin to FAILED
 * after this many consecutive failed re-verifications, and mint a token from
 * this many random bytes (base64url-encoded, at most 48 bytes to fit
 * VarChar(64)).
 */
export const SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_INTERVAL_DAYS = 30;
export const SECURITY_EVALUATION_WEB_ORIGIN_REVERIFY_FAILURE_THRESHOLD = 3;
export const SECURITY_EVALUATION_WEB_ORIGIN_TOKEN_BYTES = 32;

/** Evaluation keys. Each standardKey is a versioned rule set within an EvaluationCategory (ADR-037). */
export const SECURITY_EVALUATION_KEY_NPM_OSV = "npm-osv";
export const SECURITY_EVALUATION_KEY_AWS_CIS_1_5 = "aws-cis-1.5";
export const SECURITY_EVALUATION_KEY_AWS_CUSTOM = "aws-custom";
export const SECURITY_EVALUATION_KEY_THREAT_INTEL = "threat-intel";
export const SECURITY_EVALUATION_KEY_CODE_SCAN = "code-scan";
export const SECURITY_EVALUATION_KEY_WEB_POSTURE = "web-posture";

/**
 * The criteria versions this build ships. Criteria are code-defined and
 * published idempotently; a rule change is a new version, never an in-place
 * edit of a published one.
 */
export const SECURITY_EVALUATION_DEPENDENCY_RULE_SET_VERSION = "v1";
export const SECURITY_EVALUATION_DEPENDENCY_CRITERION_KEY = "dependency-vulnerability";

/** INTEL criteria (ADR-039). */
export const SECURITY_EVALUATION_INTELLIGENCE_RULE_SET_VERSION = "v1";
export const SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY = "threat-exposure";

/**
 * How far back the INTEL run registers threat-knowledge candidates as evidence
 * (ADR-037 D9.4).
 */
export const SECURITY_EVALUATION_INTEL_EVIDENCE_WINDOW_DAYS = 7;

/**
 * How long a "not-relevant" INTEL verdict stays reusable before the pair is
 * re-judged. A policy value, identical in every deployment, so it is a code
 * constant rather than a manifest env key (ADR-053).
 */
export const SECURITY_EVALUATION_INTEL_NEGATIVE_CACHE_TTL_DAYS = 7;

/**
 * Maximum number of knowledge candidates a run registers as evidence items.
 * Candidates beyond this cap are accounted in the skipped bucket instead.
 */
export const SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET = 200;

/**
 * Maximum number of LLM re-rank calls a single INTEL run may spend. Candidates
 * that would need more are not judged and land in the judgment's skipped bucket.
 */
export const SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET = 100;

/** The first CIS criteria version this build ships (ADR-027 D3). */
export const SECURITY_EVALUATION_AWS_CIS_RULE_SET_VERSION = "v1";
/** The first aws-custom criteria version this build ships (ADR-033/ADR-037). */
export const SECURITY_EVALUATION_AWS_CUSTOM_RULE_SET_VERSION = "v1";

/** The first code-scan criteria version this build ships (ADR-054). */
export const SECURITY_EVALUATION_CODE_SCAN_RULE_SET_VERSION = "v1";

/**
 * CODE_SCAN criteria (ADR-054): one ASSERTION criterion per risk category —
 * never one per rule — so a ruleset change is a version bump, not a criteria
 * churn, and finding fingerprints stay anchored to a stable category key.
 */
export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_INJECTION = "code-scan.injection";
export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_AUTH_BOUNDARY = "code-scan.auth-boundary";
export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_SECRET_EXPOSURE = "code-scan.secret-exposure";
export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_CRYPTO_MISUSE = "code-scan.crypto-misuse";
export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_DANGEROUS_CONFIG = "code-scan.dangerous-config";

export const SECURITY_EVALUATION_CODE_SCAN_CRITERION_KEYS = [
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_INJECTION,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_AUTH_BOUNDARY,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_SECRET_EXPOSURE,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_CRYPTO_MISUSE,
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_DANGEROUS_CONFIG,
] as const;

/**
 * CODE_SCAN selection budgets (ADR-054): the host lists at most maxFiles
 * files of at most maxFileBytes each; everything beyond lands in the skipped
 * bucket. The excerpt cap bounds what a single LLM call sees — files larger
 * than it are judged on their prefix and flagged `truncated`.
 */
export const SECURITY_EVALUATION_CODE_SCAN_MAX_FILES = 200;
export const SECURITY_EVALUATION_CODE_SCAN_MAX_FILE_BYTES = 65_536;
export const SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS = 12_000;

/**
 * How long the truncated excerpt of a judged file is kept after the run that
 * observed it. The excerpt is source code, so it never enters the immutable
 * result manifest: it lives in its own table and is physically deleted once it
 * is older than this window, after which the finding detail read falls back to
 * the content hash and the truncated flag (ADR-054 D7).
 */
export const SECURITY_EVALUATION_CODE_SCAN_EXCERPT_RETENTION_DAYS = 90;

/**
 * How long a CODE_SCAN verdict stays reusable before the file is re-judged.
 * Content or version changes already invalidate the cache key, so the TTL only
 * forces a long-unchanged file to be re-judged against model drift. A policy
 * value, identical in every deployment (ADR-053).
 */
export const SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS = 30;

/**
 * Maximum number of LLM judgment calls a single CODE_SCAN run may spend.
 * Files that would need more are not judged and land in the judgment's
 * skipped bucket (same discipline as the INTEL re-rank budget).
 */
export const SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET = 180;

/** The first web-posture criteria version this build ships (ADR-066 §4). */
export const SECURITY_EVALUATION_WEB_POSTURE_RULE_SET_VERSION = "v1";

/**
 * WEB_POSTURE criteria (ADR-066 §4): one ASSERTION per externally observable
 * fact, so a rule change is a version bump and finding fingerprints stay
 * anchored to a stable rule key.
 */
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_HTML = "web-posture.x-content-type-options-html";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_XCTO_API = "web-posture.x-content-type-options-api";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_HSTS = "web-posture.hsts";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_HTML = "web-posture.x-powered-by-html";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_POWERED_BY_API = "web-posture.x-powered-by-api";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_X_FRAME_OPTIONS = "web-posture.x-frame-options";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_CSP = "web-posture.content-security-policy";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_PERMISSIONS_POLICY = "web-posture.permissions-policy";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_REFERRER_POLICY = "web-posture.referrer-policy";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_LEGACY_PROTOCOL = "web-posture.tls-legacy-protocol";
export const SECURITY_EVALUATION_WEB_POSTURE_CRITERION_TLS_WEAK_CIPHER = "web-posture.tls-weak-cipher";

/**
 * HTTP observation budget of one web-posture run: the HTML entry point plus,
 * at most, the API session path. TLS is a handshake, not an HTTP request.
 */
export const SECURITY_EVALUATION_WEB_POSTURE_MAX_HTTP_REQUESTS = 2;

/** Asset knowledge vocabulary. */
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_PACKAGE = "npm.package";

/** AWS configuration knowledge vocabulary (ADR-027 D2, ADR-037 D6). */
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY = "aws.iam.account-password-policy";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ROOT_CREDENTIAL = "aws.iam.root-credential";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL = "aws.iam.user-credential";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY = "aws.iam.access-key";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT = "aws.iam.policy-document";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY = "aws.s3.bucket-security";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY = "aws.rds.instance-security";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS = "aws.ec2.security-group-ingress";
export const SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_INSTANCE_NETWORK = "aws.ec2.instance-network";

/** npm is the only ecosystem parsed in this build, matching the predecessor. */
export const SECURITY_EVALUATION_ECOSYSTEM_NPM = "npm";
/** Lockfiles the dependency evidence can resolve installed packages from. */
export const SECURITY_EVALUATION_LOCKFILE_NPM = "package-lock.json";
export const SECURITY_EVALUATION_LOCKFILE_YARN_V1 = "yarn.lock";
export const SECURITY_EVALUATION_LOCKFILE_CANDIDATES = [
  SECURITY_EVALUATION_LOCKFILE_NPM,
  SECURITY_EVALUATION_LOCKFILE_YARN_V1,
];

export const SECURITY_EVALUATION_OSV_API_BASE_URL = "https://api.osv.dev";
// 500 queries per request keeps the response (which paginates around 3000
// vulnerabilities) well inside a single page.
export const SECURITY_EVALUATION_OSV_QUERY_BATCH_SIZE = 500;
export const SECURITY_EVALUATION_OSV_DETAIL_CONCURRENCY = 10;
export const SECURITY_EVALUATION_OSV_REQUEST_TIMEOUT_MS = 30_000;

/** Reported as stale when an asset has not been observed within this window. */
export const SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS = 7;

/**
 * An OPEN finding not re-observed within this window is stale: the run that
 * used to reproduce it stopped covering it (asset no longer evaluated, rule
 * removed) without ever resolving it — worth surfacing for triage.
 */
export const SECURITY_EVALUATION_FINDING_STALE_AFTER_DAYS = 7;

/** Trend and mean-time-to-resolve windows of the report read model. */
export const SECURITY_EVALUATION_REPORT_TREND_WEEKS = 12;

/** Default and maximum window of the report's daily severity trend. */
export const SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS = 30;
export const SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS_MAX = 365;

/**
 * Scheduling declarations only. The host decides the cron and the trigger
 * conditions; the module never registers a scheduler of its own.
 */
export const SECURITY_EVALUATION_SCHEDULES = [
  {
    standardKey: SECURITY_EVALUATION_KEY_NPM_OSV,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
    recommendedInterval: "daily",
  },
  {
    standardKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
    recommendedInterval: "daily",
  },
  {
    standardKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
    recommendedInterval: "daily",
  },
  {
    standardKey: SECURITY_EVALUATION_KEY_THREAT_INTEL,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
    recommendedInterval: "hourly",
  },
  {
    standardKey: SECURITY_EVALUATION_KEY_CODE_SCAN,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
    recommendedInterval: "daily",
  },
  {
    standardKey: SECURITY_EVALUATION_KEY_WEB_POSTURE,
    subjectKind: SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
    recommendedInterval: "daily",
  },
] as const;
