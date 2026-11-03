/**
 * Verdict-cache port for INTEL matching (ADR-018, ADR-045, R4-04, R4-09).
 *
 * Every judgment outcome that is stable over short runs is recorded per
 * (knowledge item, scope):
 * - `not-relevant`: LLM re-ranker said this item has no bearing. Cached for
 *   NEGATIVE_CACHE_TTL_DAYS (default 7); subsequent runs skip the pair.
 * - `hard-hit`: hard-recall matched this item to this scope's entities.
 *   Audit only — the pair still re-enters the pipeline each run.
 *
 * The read side belongs to the collection layer (evidence registration), the
 * write side to the judgment layer — both depend on this port instead of
 * Prisma, keeping `judgment/` free of infrastructure imports.
 */
export const securityEvaluationIntelNegativeCacheToken = "SECURITY_EVALUATION_INTEL_NEGATIVE_CACHE";

export type SecurityEvaluationVerdictKind = "not-relevant" | "hard-hit";

export interface SecurityEvaluationIntelNegativeCachePort {
  /**
   * Of the given knowledge item ids, which are not yet cached as "not-relevant"
   * for this scope (respecting TTL). Returns the ids in input order; an empty
   * input yields an empty result. Hard-hit cache rows are intentionally not
   * filtered — they are audit-only, the pair re-enters the pipeline each run.
   */
  filterUncached(scopeKey: string, knowledgeItemIds: readonly string[]): Promise<string[]>;
  /** Record a verdict for this (knowledge item, scope) pair. */
  record(
    knowledgeItemId: string,
    scopeKey: string,
    verdict: SecurityEvaluationVerdictKind,
    reason?: string | null,
    matchedEntity?: string | null,
  ): Promise<void>;
}
