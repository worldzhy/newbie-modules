/** Feature key this module registers subjects under (ADR-069). */
export const PENETRATION_TESTING_SUBJECT_TYPE = "penetration-testing";

/**
 * Subject kind owned by this feature (ADR-075 §1). It must not reuse
 * `web-origin`: the three skeleton ports are keyed by kind through global DI
 * tokens, and `SecurityEvaluationModule` already owns that kind.
 */
export const PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET = "web-target";

export const PENETRATION_TESTING_SUBJECT_KINDS = [PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET] as const;

export type PenetrationTestingSubjectKind = (typeof PENETRATION_TESTING_SUBJECT_KINDS)[number];

/** The four test intensities (ADR-075 §2). One subject, four keys. */
export const PENETRATION_TESTING_LEVELS = ["L1", "L2", "L3", "L4"] as const;

export type PenetrationTestingLevel = (typeof PENETRATION_TESTING_LEVELS)[number];

export const PENETRATION_TESTING_KEY_ATTACK_SURFACE = "attack-surface";
export const PENETRATION_TESTING_KEY_VULNERABILITY_SCAN = "vulnerability-scan";
export const PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION = "exploit-verification";
export const PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING = "destructive-testing";

export const PENETRATION_TESTING_KEYS = [
  PENETRATION_TESTING_KEY_ATTACK_SURFACE,
  PENETRATION_TESTING_KEY_VULNERABILITY_SCAN,
  PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION,
  PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
] as const;

export type PenetrationTestingKey = (typeof PENETRATION_TESTING_KEYS)[number];

/** Level → key, the only mapping; the gate and criteria provider both read it. */
export const PENETRATION_TESTING_LEVEL_BY_KEY: Readonly<Record<PenetrationTestingKey, PenetrationTestingLevel>> = {
  [PENETRATION_TESTING_KEY_ATTACK_SURFACE]: "L1",
  [PENETRATION_TESTING_KEY_VULNERABILITY_SCAN]: "L2",
  [PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION]: "L3",
  [PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING]: "L4",
};

export function isPenetrationTestingKey(value: unknown): value is PenetrationTestingKey {
  return typeof value === "string" && (PENETRATION_TESTING_KEYS as readonly string[]).includes(value);
}

/** The criteria version this build ships for every key (ADR-037). */
export const PENETRATION_TESTING_RULE_SET_VERSION = "v1";

/**
 * ASSERTION criteria (ADR-075 §6). Every criterion is an assertion: one fact,
 * one finding. Coverage is expressed by the skeleton's coverage stats, never by
 * a numeric score.
 */
export const PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE = "exposed-service";
export const PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE = "certificate-issue";
export const PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE = "technology-disclosure";
export const PENETRATION_TESTING_CRITERION_TLS_WEAKNESS = "tls-weakness";
export const PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION = "security-misconfiguration";
export const PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT = "vulnerable-component";
export const PENETRATION_TESTING_CRITERION_INJECTION = "injection";
export const PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL = "broken-access-control";
export const PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE = "exposed-sensitive-file";
export const PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT = "confirmed-exploit";
export const PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT = "destructive-impact";
export const PENETRATION_TESTING_CRITERION_UNCLASSIFIED = "unclassified";

export const PENETRATION_TESTING_CRITERION_KEYS = [
  PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE,
  PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
  PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
  PENETRATION_TESTING_CRITERION_TLS_WEAKNESS,
  PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
  PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
  PENETRATION_TESTING_CRITERION_INJECTION,
  PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
  PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
  PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT,
  PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
  PENETRATION_TESTING_CRITERION_UNCLASSIFIED,
] as const;

export type PenetrationTestingCriterionKey = (typeof PENETRATION_TESTING_CRITERION_KEYS)[number];

/**
 * Which criterion each key can emit. A key version only accepts findings for
 * its own criteria; the judgment filters against this set so an engine rule
 * cannot smuggle a criterion into the wrong rule set.
 */
export const PENETRATION_TESTING_CRITERIA_BY_KEY: Readonly<Record<PenetrationTestingKey, readonly string[]>> = {
  [PENETRATION_TESTING_KEY_ATTACK_SURFACE]: [
    PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE,
    PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
    PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
    PENETRATION_TESTING_CRITERION_TLS_WEAKNESS,
  ],
  [PENETRATION_TESTING_KEY_VULNERABILITY_SCAN]: [
    PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
    PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
    PENETRATION_TESTING_CRITERION_INJECTION,
    PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
    PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
    PENETRATION_TESTING_CRITERION_UNCLASSIFIED,
  ],
  [PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION]: [PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT],
  [PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING]: [PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT],
};

/** Target environment; L4 is non-production only (ADR-075 §2, §4). */
export const PENETRATION_TESTING_ENVIRONMENTS = ["PRODUCTION", "NON_PRODUCTION"] as const;

export type PenetrationTestingEnvironment = (typeof PENETRATION_TESTING_ENVIRONMENTS)[number];

export const PENETRATION_TESTING_AUTHORIZATION_STATUSES = ["PENDING", "APPROVED", "REVOKED", "EXPIRED"] as const;

export type PenetrationTestingAuthorizationStatus = (typeof PENETRATION_TESTING_AUTHORIZATION_STATUSES)[number];

export const PENETRATION_TESTING_TEST_OBJECT_KINDS = ["RECORD", "ACCOUNT", "FILE", "PATH"] as const;

export type PenetrationTestingTestObjectKind = (typeof PENETRATION_TESTING_TEST_OBJECT_KINDS)[number];

/**
 * Fixed L4 playbook catalogue (ADR-075 §2, B′). Playbooks are code, not data:
 * a new destructive proof ships as a reviewed module version, never as a
 * database row an operator can edit.
 */
export interface PenetrationTestingPlaybook {
  id: string;
  version: string;
  attackClass: string;
  testObjectKind: PenetrationTestingTestObjectKind;
  description: string;
}

export const PENETRATION_TESTING_PLAYBOOKS: readonly PenetrationTestingPlaybook[] = [
  {
    id: "sqli-write-proof",
    version: "v1",
    attackClass: "sql-injection",
    testObjectKind: "RECORD",
    description:
      "Prove write access through a SQL injection by inserting a marker row in the declared disposable record scope, reading it back, then deleting it.",
  },
  {
    id: "upload-proof",
    version: "v1",
    attackClass: "unrestricted-file-upload",
    testObjectKind: "FILE",
    description:
      "Prove code or content execution through an upload endpoint by writing a marker file to the declared disposable path, reading it back, then deleting it.",
  },
  {
    id: "stored-xss-proof",
    version: "v1",
    attackClass: "stored-xss",
    testObjectKind: "RECORD",
    description:
      "Prove stored script execution by writing a marker payload to the declared disposable record, confirming it is served unescaped, then deleting the record.",
  },
  {
    id: "cmd-injection-proof",
    version: "v1",
    attackClass: "command-injection",
    testObjectKind: "PATH",
    description:
      "Prove command execution by running a benign marker command in the declared disposable path, reading its output, then removing the marker.",
  },
] as const;

export function findPlaybook(id: unknown): PenetrationTestingPlaybook | null {
  if (typeof id !== "string") return null;
  return PENETRATION_TESTING_PLAYBOOKS.find((playbook) => playbook.id === id) ?? null;
}

/** Per-level execution budget (ADR-075 §5). Policy values, not deployment env. */
export interface PenetrationTestingBudget {
  maxRequests: number;
  timeoutMs: number;
  maxConcurrency: number;
  maxRequestsPerSecond: number;
}

export const PENETRATION_TESTING_BUDGET_BY_KEY: Readonly<Record<PenetrationTestingKey, PenetrationTestingBudget>> = {
  [PENETRATION_TESTING_KEY_ATTACK_SURFACE]: {
    maxRequests: 2_000,
    timeoutMs: 300_000,
    maxConcurrency: 1,
    maxRequestsPerSecond: 20,
  },
  [PENETRATION_TESTING_KEY_VULNERABILITY_SCAN]: {
    maxRequests: 5_000,
    timeoutMs: 900_000,
    maxConcurrency: 2,
    maxRequestsPerSecond: 25,
  },
  [PENETRATION_TESTING_KEY_EXPLOIT_VERIFICATION]: {
    maxRequests: 500,
    timeoutMs: 300_000,
    maxConcurrency: 1,
    maxRequestsPerSecond: 5,
  },
  [PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING]: {
    maxRequests: 50,
    timeoutMs: 300_000,
    maxConcurrency: 1,
    maxRequestsPerSecond: 1,
  },
};

/** Ownership verification policy, identical in every deployment (ADR-044 §2, ADR-053). */
export const PENETRATION_TESTING_VERIFICATION_INTERVAL_DAYS = 30;
export const PENETRATION_TESTING_REVERIFY_FAILURE_THRESHOLD = 3;
export const PENETRATION_TESTING_TOKEN_BYTES = 32;

export const PENETRATION_TESTING_DNS_TXT_NAME_PREFIX = "_nightwatch-verify";
export const PENETRATION_TESTING_DNS_TXT_VALUE_PREFIX = "nightwatch-verify=";
export const PENETRATION_TESTING_WELL_KNOWN_PATH = "/.well-known/nightwatch-verification.txt";

export const PENETRATION_TESTING_VERIFICATION_METHODS = ["DNS_TXT", "WELL_KNOWN"] as const;

export type PenetrationTestingVerificationMethod = (typeof PENETRATION_TESTING_VERIFICATION_METHODS)[number];

/** Path roles a scan may target; the asset owns role → relative path. */
export const PENETRATION_TESTING_PATH_ROLES = ["entry", "api.session"] as const;

export type PenetrationTestingPathRole = (typeof PENETRATION_TESTING_PATH_ROLES)[number];

/**
 * Scheduling declarations only. The host decides the cron; L1/L2 are the only
 * levels that may ever be scheduled (ADR-075 §2, ADR-049 §2).
 */
export const PENETRATION_TESTING_SCHEDULES = [
  {
    standardKey: PENETRATION_TESTING_KEY_ATTACK_SURFACE,
    subjectKind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
    recommendedInterval: "weekly",
  },
  {
    standardKey: PENETRATION_TESTING_KEY_VULNERABILITY_SCAN,
    subjectKind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
    recommendedInterval: "weekly",
  },
] as const;

/** Evidence retention of raw engine artefacts (ADR-075 §7). */
export const PENETRATION_TESTING_RAW_EVIDENCE_RETENTION_DAYS = 180;

/** Execution outcomes of the feature's own audit row (ADR-075 §3). */
export const PENETRATION_TESTING_EXECUTION_OUTCOMES = ["SUCCEEDED", "FAILED", "KILLED", "CLEANUP_FAILED"] as const;

export type PenetrationTestingExecutionOutcome = (typeof PENETRATION_TESTING_EXECUTION_OUTCOMES)[number];
