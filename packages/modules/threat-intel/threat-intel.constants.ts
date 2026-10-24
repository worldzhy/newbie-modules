/**
 * Canonical enums for the threat-intel module.
 *
 * Source identifiers are stable keys used by adapters and stored on
 * `ThreatIntelItem.source`. Categories partition items so deduplication
 * keys never collide across categories.
 */

/** Information source identifiers. Each adapter registers exactly one. */
export const THREAT_INTEL_SOURCE = {
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
  EXPLOIT_DB: "exploit-db",
} as const;

export type ThreatIntelSource = (typeof THREAT_INTEL_SOURCE)[keyof typeof THREAT_INTEL_SOURCE];

/** Item category. Determines the deduplication key semantics. */
export const THREAT_INTEL_CATEGORY = {
  CVE: "cve",
  MALICIOUS_PACKAGE: "malicious-package",
  PLATFORM_EVENT: "platform-event",
  CN_NEWS: "cn-news",
} as const;

export type ThreatIntelCategory = (typeof THREAT_INTEL_CATEGORY)[keyof typeof THREAT_INTEL_CATEGORY];

export const THREAT_INTEL_SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const;

export type ThreatIntelSeverity = (typeof THREAT_INTEL_SEVERITY)[keyof typeof THREAT_INTEL_SEVERITY];

/** Signal tags mark an item with high-priority threat indicators. */
export const THREAT_INTEL_SIGNAL_TAG = {
  KEV: "kev",
  HAS_EXPLOIT: "has-exploit",
  EXPLOITED_IN_WILD: "exploited-in-wild",
} as const;

export type ThreatIntelSignalTag = (typeof THREAT_INTEL_SIGNAL_TAG)[keyof typeof THREAT_INTEL_SIGNAL_TAG];

export const THREAT_INTEL_MATCH_TYPE = {
  ENTITY: "entity",
  SEMANTIC: "semantic",
} as const;

export type ThreatIntelMatchType = (typeof THREAT_INTEL_MATCH_TYPE)[keyof typeof THREAT_INTEL_MATCH_TYPE];

export const THREAT_INTEL_MATCH_STATUS = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  FALSE_POSITIVE: "false-positive",
} as const;

export type ThreatIntelMatchStatus = (typeof THREAT_INTEL_MATCH_STATUS)[keyof typeof THREAT_INTEL_MATCH_STATUS];

export const THREAT_INTEL_CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type ThreatIntelConfidence = (typeof THREAT_INTEL_CONFIDENCE)[keyof typeof THREAT_INTEL_CONFIDENCE];

/**
 * Default retention window for threat intel items. Older items are pruned
 * by the single retention cleanup job (see ThreatIntelService.pruneExpired).
 */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Maximum number of items kept per source. Acts as a safety cap alongside
 * the time-based retention. Enforced only by the single cleanup job.
 */
export const DEFAULT_MAX_ITEMS_PER_SOURCE = 1000;
