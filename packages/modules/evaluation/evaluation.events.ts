import { defineEvent } from "@modules/event-emitter/event-definition";

/** Emitted after a run reaches SUCCEEDED and its result is archived. */
export const EVALUATION_RUN_SUCCEEDED_EVENT = "evaluation.run-succeeded";

/** Emitted after a run reaches FAILED and its failure reason is persisted. */
export const EVALUATION_RUN_FAILED_EVENT = "evaluation.run-failed";

/** The identity every terminal run event carries — no findings or coverage. */
export interface EvaluationRunEventIdentity {
  runId: string;
  subjectId: string;
  subjectKind: string;
  ruleSetVersionId: string;
  evaluationKey: string;
}

export interface EvaluationRunSucceededEvent extends EvaluationRunEventIdentity {
  status: "SUCCEEDED";
}

export interface EvaluationRunFailedEvent extends EvaluationRunEventIdentity {
  status: "FAILED";
  /** Same text and truncation as the run row's `error` (ADR-032 D5). */
  error: string;
}

const EVALUATION_RUN_SUCCEEDED = defineEvent<EvaluationRunSucceededEvent>({
  key: EVALUATION_RUN_SUCCEEDED_EVENT,
  name: "Evaluation run succeeded",
  description: "Emitted after a run reaches SUCCEEDED and its result is archived.",
  payloadExample: {
    runId: "3f0f2a8e-2c47-4b3e-9f61-0a1b2c3d4e5f",
    subjectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    subjectKind: "repository",
    ruleSetVersionId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    evaluationKey: "npm-osv",
    status: "SUCCEEDED",
  },
});

const EVALUATION_RUN_FAILED = defineEvent<EvaluationRunFailedEvent>({
  key: EVALUATION_RUN_FAILED_EVENT,
  name: "Evaluation run failed",
  description: "Emitted after a run reaches FAILED and its failure reason is persisted.",
  payloadExample: {
    runId: "3f0f2a8e-2c47-4b3e-9f61-0a1b2c3d4e5f",
    subjectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    subjectKind: "repository",
    ruleSetVersionId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    evaluationKey: "npm-osv",
    status: "FAILED",
    error: "OSV API request timed out after 30000ms",
  },
});

/// The module's run lifecycle contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const evaluationEventDeclarations = [EVALUATION_RUN_SUCCEEDED, EVALUATION_RUN_FAILED];
