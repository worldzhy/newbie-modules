/**
 * Negative-cache port for INTEL matching (ADR-018, ADR-045).
 *
 * An LLM "not-relevant" verdict is remembered per (knowledge item, scope) so
 * later runs skip the pair; "unavailable" verdicts are never recorded. The
 * read side belongs to the collection layer (evidence registration), the
 * write side to the judgment layer — both depend on this port instead of
 * Prisma, keeping `judgment/` free of infrastructure imports.
 */
export const securityEvaluationIntelNegativeCacheToken = "SECURITY_EVALUATION_INTEL_NEGATIVE_CACHE";

export interface SecurityEvaluationIntelNegativeCachePort {
  /**
   * Of the given knowledge item ids, which are not yet cached for this scope.
   * Returns the ids in input order; an empty input yields an empty result.
   */
  filterUncached(scopeKey: string, knowledgeItemIds: readonly string[]): Promise<string[]>;
  /** Remember that this item was judged not relevant for this scope. */
  record(knowledgeItemId: string, scopeKey: string, reason: string): Promise<void>;
}
