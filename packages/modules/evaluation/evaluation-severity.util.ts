import type { EvaluationFindingSeverity } from "./ports/evaluation.contracts";

/**
 * Severity vocabulary shared by evaluation, security-evaluation and the host
 * notification layer (ADR-020 D4).
 *
 * The contract union is the type source of truth; this tuple is its runtime
 * form. Keep the two aligned: a value added to one must be added to the other,
 * and evaluation-severity.mapping.test.ts already pins the persisted mirror.
 */
export const SEVERITIES = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const satisfies readonly EvaluationFindingSeverity[];

/** Ordinal rank for threshold and merge comparisons; CRITICAL is highest. */
export const SEVERITY_RANK: Record<EvaluationFindingSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

/** Severities that warrant an alert without further judgment. */
export const HIGH_SEVERITIES: EvaluationFindingSeverity[] = ["CRITICAL", "HIGH"];

/** Runtime membership check for a severity value crossing a port boundary. */
export function isSeverity(value: unknown): value is EvaluationFindingSeverity {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}
