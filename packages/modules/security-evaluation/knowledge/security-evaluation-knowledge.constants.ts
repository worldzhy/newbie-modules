/**
 * Canonical enums for the security-evaluation knowledge subdomain (ADR-039).
 *
 * Source identifiers are stable keys used by adapters and stored on
 * `SecurityEvaluationThreatKnowledgeItem.source`. Categories partition items so
 * deduplication keys never collide across categories.
 *
 * Ported from the former threat-intelligence module; values are unchanged.
 */

/**
 * Information source identifiers. Each adapter registers exactly one.
 *
 * The taxonomy is intentionally pre-registered beyond the implemented
 * adapters (ADR-031 source catalog): filters and stored rows stay stable
 * as new adapters land, so values without a current adapter are expected.
 */
export const SECURITY_EVALUATION_KNOWLEDGE_SOURCE = {
  NVD: "nvd",
  CISA_KEV: "cisa-kev",
  GITHUB_SECURITY_ADVISORY: "github-security-advisory",
  OSV: "osv",
  NPM_ADVISORIES: "npm-advisories",
  PYPI_ADVISORIES: "pypi-advisories",
  RUBYGEMS_ADVISORIES: "rubygems-advisories",
  CRATES_IO_ADVISORIES: "crates-io-advisories",
  MAVEN_ADVISORIES: "maven-advisories",
  SNYK_ADVISORIES: "snyk-advisories",
  AWS_SECURITY_BULLETINS: "aws-security-bulletins",
  GITHUB_SECURITY_BLOG: "github-security-blog",
  CLOUDFLARE_ADVISORIES: "cloudflare-advisories",
  FASTLY_ADVISORIES: "fastly-advisories",
  VERCEL_ADVISORIES: "vercel-advisories",
  NETLIFY_ADVISORIES: "netlify-advisories",
  ALIYUN_SECURITY: "aliyun-security",
  TENCENT_CLOUD_SECURITY: "tencent-cloud-security",
  HUAWEI_CLOUD_SECURITY: "huawei-cloud-security",
  ANQUANKE: "anquanke",
  XZONE: "xzone",
  QI_ANXIN_CERT: "qi-anxin-cert",
  NSFOCUS: "nsfocus",
  KNOWNSEC: "knownsec",
  FREEBUF: "freebuf",
  SIHOU: "sihou",
  THE_HACKER_NEWS: "the-hacker-news",
  BLEEPING_COMPUTER: "bleeping-computer",
  EXPLOIT_DB: "exploit-db",
} as const;

export type SecurityEvaluationKnowledgeSource =
  (typeof SECURITY_EVALUATION_KNOWLEDGE_SOURCE)[keyof typeof SECURITY_EVALUATION_KNOWLEDGE_SOURCE];

/** Item category. Determines the deduplication key semantics. */
export const SECURITY_EVALUATION_KNOWLEDGE_CATEGORY = {
  CVE: "cve",
  MALICIOUS_PACKAGE: "malicious-package",
  PLATFORM_EVENT: "platform-event",
  CN_NEWS: "cn-news",
  EN_NEWS: "en-news",
} as const;

export type SecurityEvaluationKnowledgeCategory =
  (typeof SECURITY_EVALUATION_KNOWLEDGE_CATEGORY)[keyof typeof SECURITY_EVALUATION_KNOWLEDGE_CATEGORY];

export const SECURITY_EVALUATION_KNOWLEDGE_SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const;

export type SecurityEvaluationKnowledgeSeverity =
  (typeof SECURITY_EVALUATION_KNOWLEDGE_SEVERITY)[keyof typeof SECURITY_EVALUATION_KNOWLEDGE_SEVERITY];

/** Signal tags mark an item with high-priority threat indicators. */
export const SECURITY_EVALUATION_KNOWLEDGE_SIGNAL_TAG = {
  KEV: "kev",
  HAS_EXPLOIT: "has-exploit",
  EXPLOITED_IN_WILD: "exploited-in-wild",
} as const;

export type SecurityEvaluationKnowledgeSignalTag =
  (typeof SECURITY_EVALUATION_KNOWLEDGE_SIGNAL_TAG)[keyof typeof SECURITY_EVALUATION_KNOWLEDGE_SIGNAL_TAG];

/**
 * Default retention window for knowledge items. Older items are pruned
 * by the single retention cleanup job.
 */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Maximum number of items kept per source. Acts as a safety cap alongside
 * the time-based retention. Enforced only by the single cleanup job.
 */
export const DEFAULT_MAX_ITEMS_PER_SOURCE = 1000;
