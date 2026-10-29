import type { EvaluationFindingSeverity } from "./evaluation.contracts";

/**
 * EvaluationObserver — the optional fifth port. A host binds it to be told
 * about run completions and finding lifecycle changes (notifications, metrics,
 * audit). Unlike the four core ports, no binding is a legal state: the
 * skeleton simply reports to nobody.
 *
 * Observer failures never fail a run — the skeleton logs and swallows them.
 * An observer that must be reliable should therefore be backed by a durable
 * outbox on the host side.
 */
export const evaluationObserverToken = "EVALUATION_OBSERVER";

export interface EvaluationRunFinishedEvent {
  runId: string;
  subjectId: string;
  ruleSetVersionId: string;
  status: "SUCCEEDED" | "FAILED";
  /** Failure text when status is FAILED. */
  error?: string;
}

export type EvaluationFindingChange = "created" | "reopened" | "resolved" | "suppressed";

export interface EvaluationFindingChangedEvent {
  findingId: string;
  subjectId: string;
  evaluationKey: string;
  fingerprint: string;
  severity: EvaluationFindingSeverity;
  change: EvaluationFindingChange;
}

export interface EvaluationObserver {
  onRunFinished?(event: EvaluationRunFinishedEvent): Promise<void>;
  onFindingChanged?(event: EvaluationFindingChangedEvent): Promise<void>;
}
