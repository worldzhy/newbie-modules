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

/** One pair whose cached verdict is being tested against a current signature. */
export interface SecurityEvaluationIntelCacheCandidate {
  knowledgeItemId: string;
  /**
   * Content address of the judgment input for this candidate (model + prompt
   * + item text + entity set). A cached row recorded under a different
   * signature describes a different input and must not be reused.
   */
  signature: string;
}

export interface SecurityEvaluationIntelVerdictRecord {
  knowledgeItemId: string;
  scopeKey: string;
  verdict: SecurityEvaluationVerdictKind;
  /** Content address of the input that produced this verdict. */
  signature: string;
  reason?: string | null;
  matchedEntity?: string | null;
}

export interface SecurityEvaluationIntelNegativeCachePort {
  /**
   * Of the given candidates, which are not yet cached as "not-relevant" for
   * this scope under the current signature (respecting TTL). Returns the ids
   * in input order; an empty input yields an empty result. Hard-hit cache
   * rows are intentionally not filtered — they are audit-only, the pair
   * re-enters the pipeline each run.
   */
  filterUncached(scopeKey: string, candidates: readonly SecurityEvaluationIntelCacheCandidate[]): Promise<string[]>;
  /** Record a verdict for this (knowledge item, scope) pair. */
  record(entry: SecurityEvaluationIntelVerdictRecord): Promise<void>;
}
