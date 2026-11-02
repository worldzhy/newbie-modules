import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

/**
 * One judgment mechanism (ADR-046): a unit of judgment logic that can be
 * composed per evaluationKey. `name` is a module-local constant used for
 * result namespacing and conflict messages — it carries no host vocabulary.
 */
export interface SecurityEvaluationJudgmentMechanism {
  readonly name: string;
  judge(input: JudgmentInput): Promise<EvaluationJudgment>;
}

/** DI token for the mechanism set the dispatcher composes. */
export const SECURITY_EVALUATION_JUDGMENT_MECHANISMS = "SECURITY_EVALUATION_JUDGMENT_MECHANISMS";

export const SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY = "dependency";
export const SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG = "aws-config";
export const SECURITY_EVALUATION_MECHANISM_NAME_INTEL = "intel";
