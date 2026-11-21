import { createHash } from "node:crypto";
import type { EvaluationFindingSeverity } from "@modules/evaluation/ports/evaluation.contracts";

import {
  PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
  PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
  PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT,
  PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
  PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE,
  PENETRATION_TESTING_CRITERION_INJECTION,
  PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
  PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
  PENETRATION_TESTING_CRITERION_TLS_WEAKNESS,
  PENETRATION_TESTING_CRITERION_UNCLASSIFIED,
  PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
} from "../penetration-testing.constants";
import type { PenetrationTestingEngineFinding } from "../ports/penetration-testing.contracts";

/**
 * Deterministic engine → criterion mapping (ADR-075 §6). Data, not code paths:
 * an engine rule either matches a named criterion or falls into `unclassified`;
 * nothing is dropped (ADR-020 D5.2).
 */
const RULE_TABLE: readonly { engine?: string; pattern: RegExp; criterion: string }[] = [
  { engine: "connect-probe", pattern: /.*/, criterion: PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE },
  { engine: "sslyze", pattern: /.*/, criterion: PENETRATION_TESTING_CRITERION_TLS_WEAKNESS },
  {
    engine: "httpx",
    pattern: /(tls|certificate|cert|ssl)/i,
    criterion: PENETRATION_TESTING_CRITERION_CERTIFICATE_ISSUE,
  },
  {
    engine: "httpx",
    pattern: /(tech|server|powered-by|x-generator)/i,
    criterion: PENETRATION_TESTING_CRITERION_TECHNOLOGY_DISCLOSURE,
  },
  { engine: "httpx", pattern: /.*/, criterion: PENETRATION_TESTING_CRITERION_EXPOSED_SERVICE },
  {
    pattern: /(sql[\s-]?injection|sqli|sqlmap|command[\s-]?injection|ssti|template[\s-]?injection)/i,
    criterion: PENETRATION_TESTING_CRITERION_INJECTION,
  },
  {
    pattern: /(access[\s-]?control|authorization|auth[\s-]?bypass|idor|broken[\s-]?auth)/i,
    criterion: PENETRATION_TESTING_CRITERION_BROKEN_ACCESS_CONTROL,
  },
  {
    pattern: /(sensitive|exposure|backup|\.git|\.env|debug|actuator|swagger)/i,
    criterion: PENETRATION_TESTING_CRITERION_EXPOSED_SENSITIVE_FILE,
  },
  {
    pattern: /(cve-\d{4}-\d+|outdated|vulnerable[\s-]?component|component[\s-]?version)/i,
    criterion: PENETRATION_TESTING_CRITERION_VULNERABLE_COMPONENT,
  },
  {
    pattern: /(misconfig|cors|cookie|header|security[\s-]?policy|clickjack)/i,
    criterion: PENETRATION_TESTING_CRITERION_SECURITY_MISCONFIGURATION,
  },
];

export function mapEngineFindingCriterion(
  finding: PenetrationTestingEngineFinding,
  allowedCriteria: ReadonlySet<string>,
): string {
  const haystack = [finding.ruleId, finding.ruleName ?? "", finding.title, ...(finding.tags ?? [])].join(" ");
  const engine = finding.engine.toLowerCase();
  for (const rule of RULE_TABLE) {
    if (rule.engine && rule.engine !== engine) continue;
    if (!rule.pattern.test(haystack)) continue;
    if (allowedCriteria.has(rule.criterion)) return rule.criterion;
  }
  if (allowedCriteria.has(PENETRATION_TESTING_CRITERION_UNCLASSIFIED)) {
    return PENETRATION_TESTING_CRITERION_UNCLASSIFIED;
  }
  // A rule set without the catch-all can still receive foreign engine output;
  // the first allowed criterion is the only honest sink left.
  return [...allowedCriteria][0] ?? PENETRATION_TESTING_CRITERION_UNCLASSIFIED;
}

export function normalizeSeverity(raw: string, cvssScore?: number): EvaluationFindingSeverity {
  if (typeof cvssScore === "number" && Number.isFinite(cvssScore)) {
    if (cvssScore >= 9) return "CRITICAL";
    if (cvssScore >= 7) return "HIGH";
    if (cvssScore >= 4) return "MEDIUM";
    if (cvssScore > 0) return "LOW";
    return "INFO";
  }
  const value = raw.trim().toLowerCase();
  if (value === "critical" || value === "4") return "CRITICAL";
  if (value === "high" || value === "3") return "HIGH";
  if (value === "medium" || value === "moderate" || value === "2") return "MEDIUM";
  if (value === "low" || value === "1") return "LOW";
  return "INFO";
}

const SEVERITY_ORDER: readonly EvaluationFindingSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** E2 policy: a confirmed exploit may raise a suspected finding by one level, never by two. */
export function upliftSeverity(severity: EvaluationFindingSeverity, levels = 1): EvaluationFindingSeverity {
  const index = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, index + levels)];
}

export function isConfirmedExploitCriterion(criterionKey: string): boolean {
  return criterionKey === PENETRATION_TESTING_CRITERION_CONFIRMED_EXPLOIT;
}

/**
 * Stable finding identity: subject is implicit in the table key, so the
 * fingerprint covers criterion, engine rule and location (ADR-075 §6).
 */
export function penetrationTestingFingerprint(parts: {
  criterionKey: string;
  engine: string;
  ruleId: string;
  location: string;
}): string {
  return createHash("sha256")
    .update([parts.criterionKey, parts.engine, parts.ruleId, parts.location].join("\u0000"))
    .digest("hex");
}
