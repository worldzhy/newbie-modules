import type { EvaluationSubjectRef } from "./evaluation.contracts";

/**
 * CriteriaProvider (ADR-020 D4) — implemented by the feature that owns the
 * criteria content. It answers one question only: which published version
 * applies to this subject.
 *
 * Bindings are kind-scoped, following the `installationResolverToken(kind)`
 * precedent: a feature evaluating two subject kinds binds the same instance
 * under both tokens.
 */
export const criteriaProviderToken = (kind: string): string => `EVALUATION_CRITERIA_PROVIDER:${kind}`;

export interface CriteriaSelection {
  family: string;
  version: string;
}

export interface CriteriaProvider {
  /** Null means the feature has published no applicable version yet. */
  selectVersion(subject: EvaluationSubjectRef): Promise<CriteriaSelection | null>;
}
