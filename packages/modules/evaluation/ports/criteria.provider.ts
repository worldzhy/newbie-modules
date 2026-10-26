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
  /**
   * Null means the feature has published no applicable version yet.
   *
   * `runConfig` is the opaque per-run feature config from `StartEvaluationRunInput`
   * (ADR-023/ADR-026), passed verbatim when the run opener lets the feature pick
   * the version. Features that do not need it simply omit the parameter.
   */
  selectVersion(
    subject: EvaluationSubjectRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<CriteriaSelection | null>;
}
