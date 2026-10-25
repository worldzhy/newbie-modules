import type {
  EvaluationCoverageBucket,
  EvaluationCriterionRef,
  EvaluationCriteriaVersionRef,
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
  EvaluationSubjectRef,
  EvaluationVerdict,
} from "./evaluation.contracts";

/**
 * JudgmentPort (ADR-020 D4) — implemented by the feature. Deterministic
 * judgments (version ranges, configuration baselines) and LLM-assisted ones
 * (intel relevance) both plug in here; the skeleton knows neither.
 *
 * Bindings are kind-scoped, following the `installationResolverToken(kind)`
 * precedent.
 */
export const judgmentPortToken = (kind: string): string => `EVALUATION_JUDGMENT:${kind}`;

export interface JudgmentInput {
  subject: EvaluationSubjectRef;
  criteriaVersion: EvaluationCriteriaVersionRef;
  criteria: EvaluationCriterionRef[];
  evidence: EvaluationEvidenceItem[];
  /**
   * Opaque per-run config the trigger passed (ADR-023) — e.g. which model to
   * judge with. Null when the run was opened without one; the port decides
   * what each key means.
   */
  runConfig: Record<string, unknown> | null;
}

export interface EvaluationJudgment {
  /** Products of SCORED criteria. */
  verdicts: EvaluationVerdict[];
  /** Products of ASSERTION criteria. */
  findings: EvaluationFindingCandidate[];
  /** Evidence ids the judgment actually examined — the evaluated bucket is derived from this. */
  evaluatedRefs: string[];
  /** Material a judgment budget cut off; merged into the run's skipped bucket. */
  skipped?: EvaluationCoverageBucket;
  summary?: string;
  /**
   * Execution facts of this judgment (ADR-023 D2) — the model, scope and
   * prompt version actually used — persisted verbatim into
   * `EvaluationResult.metadata` so runs stay comparable.
   */
  metadata?: Record<string, unknown>;
}

export interface JudgmentPort {
  judge(input: JudgmentInput): Promise<EvaluationJudgment>;
}
