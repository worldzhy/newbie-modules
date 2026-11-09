import { EvaluationFindingSeverity as PersistedEvaluationFindingSeverity } from "@generated/prisma/client";

import type { EvaluationFindingSeverity } from "./ports/evaluation.contracts";

/**
 * Contract severity → persisted enum, at the Prisma boundary (ADR-020 D4).
 *
 * The contract union is the type source of truth; this table is the only place
 * that names both vocabularies. It is exhaustive by construction — a value
 * added to the contract union without a persisted counterpart fails to
 * compile — and evaluation-severity.mapping.test.ts asserts the two value sets
 * match, so the enum cannot drift either.
 */
export const PERSISTED_SEVERITY: Record<EvaluationFindingSeverity, PersistedEvaluationFindingSeverity> = {
  INFO: PersistedEvaluationFindingSeverity.INFO,
  LOW: PersistedEvaluationFindingSeverity.LOW,
  MEDIUM: PersistedEvaluationFindingSeverity.MEDIUM,
  HIGH: PersistedEvaluationFindingSeverity.HIGH,
  CRITICAL: PersistedEvaluationFindingSeverity.CRITICAL,
};

/** Translate a contract severity into the persisted vocabulary. */
export function toPersistedSeverity(severity: EvaluationFindingSeverity): PersistedEvaluationFindingSeverity {
  return PERSISTED_SEVERITY[severity];
}
