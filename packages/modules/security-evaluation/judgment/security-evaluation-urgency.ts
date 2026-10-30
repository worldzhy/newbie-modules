import type { SecurityEvaluationFindingSeverity } from "./security-evaluation-severity";

/** Derived urgency bands. P1 is act now, P4 is backlog/monitor. */
export type SecurityEvaluationUrgency = "P1" | "P2" | "P3" | "P4";

/** How exposed the asset knowledge is in the judgement's eyes. */
export type SecurityEvaluationExposure = "production" | "development" | "internal" | "unknown";

const BASE_RANK: Record<SecurityEvaluationFindingSeverity, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
  INFO: 4,
};

/**
 * Exposure derived from collected knowledge. Dependency items use `isDev`; cloud
 * account findings start at `internal` (ADR-027 D6), which carries no relief
 * until a reachability signal exists. Unknown stays at production weight — an
 * unproven development-only dependency must not be silently downgraded.
 */
export function deriveExposure(isDev: unknown): SecurityEvaluationExposure {
  if (isDev === true) return "development";
  if (isDev === false) return "production";
  return "unknown";
}

/**
 * Urgency is a deterministic function of severity and exposure, not a new
 * composite score (ADR-022 D5). One band of relief for development-only
 * exposure, never for unknown exposure, and never past P4.
 */
export function deriveUrgency(
  severity: SecurityEvaluationFindingSeverity,
  exposure: SecurityEvaluationExposure,
): SecurityEvaluationUrgency {
  const relief = exposure === "development" ? 1 : 0;
  const rank = Math.min(4, BASE_RANK[severity] + relief);
  return `P${rank}` as SecurityEvaluationUrgency;
}

const URGENCY_RANK: Record<SecurityEvaluationUrgency, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };

/** Sortable weight: P1 outranks P4. Used by read models, not persisted. */
export function deriveUrgencyRank(urgency: SecurityEvaluationUrgency): number {
  return URGENCY_RANK[urgency];
}
