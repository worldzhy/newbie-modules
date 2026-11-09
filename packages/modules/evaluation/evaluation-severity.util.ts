import type { EvaluationFindingSeverity } from "./ports/evaluation.contracts";

/**
 * Severity vocabulary shared by evaluation, security-evaluation and the host
 * notification layer (ADR-020 D4).
 *
 * The contract union is the type source of truth; this tuple is its runtime
 * form. `satisfies` alone only checks that every tuple member belongs to the
 * union, so dropping one (e.g. "INFO") would still compile. The
 * SeverityTupleIsExhaustive assertion below closes the other direction, and
 * evaluation-severity.mapping.test.ts pins both sets against the persisted
 * mirror at runtime.
 */
export const SEVERITIES = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const satisfies readonly EvaluationFindingSeverity[];

/**
 * Bidirectional guard: assigning a union member the tuple omits to a
 * `never`-constrained parameter fails to compile. Deleting "INFO" from
 * SEVERITIES makes this type alias an error instead of silently shrinking the
 * runtime vocabulary that isSeverity() and SEVERITY_RANK depend on.
 */
type AssertNever<T extends never> = T;
export type SeverityTupleIsExhaustive = AssertNever<Exclude<EvaluationFindingSeverity, (typeof SEVERITIES)[number]>>;

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
