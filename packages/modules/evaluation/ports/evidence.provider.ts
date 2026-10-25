import type {
  EvaluationCoverageBucket,
  EvaluationCriteriaVersionRef,
  EvaluationEvidenceItem,
  EvaluationSubjectRef,
} from "./evaluation.contracts";

/**
 * EvidenceProvider (ADR-020 D4) — implemented by the feature, which owns
 * collection (workspace / session / document, asset facts, cloud resources).
 *
 * The host supplies credentials and external access; this port only states what
 * a collected run receives. Whatever the collector could not gather must be
 * reported in `skipped` rather than omitted (D5.2).
 */
export const evidenceProviderToken = (kind: string): string => `EVALUATION_EVIDENCE_PROVIDER:${kind}`;

export interface EvidenceCollection {
  items: EvaluationEvidenceItem[];
  /** Declared material with no fact-layer item backing it. */
  declaredUnlinked: EvaluationCoverageBucket;
  /** Material the collector could not gather, with the reason in `note`. */
  skipped: EvaluationCoverageBucket;
}

export interface EvidenceProvider {
  collect(subject: EvaluationSubjectRef, criteriaVersion: EvaluationCriteriaVersionRef): Promise<EvidenceCollection>;
}
