import { BadRequestException } from "@nestjs/common";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";

/**
 * Subject metadata the host SubjectProvider attaches (README §subjectKey):
 * the collection period bounding the window, the evaluatee, and the identity
 * tokens that keep the judgment blind.
 */
export interface WorkEvaluationSubjectMetadata {
  periodId: string;
  evaluateeUserId: string;
  identityTokens?: string[];
}

/** The ref shape carries no metadata; the full row is what has periodId. */
export async function readWorkEvaluationSubjectMetadata(
  subjects: EvaluationSubjectService,
  subjectId: string,
): Promise<WorkEvaluationSubjectMetadata> {
  const subject = await subjects.getSubject(subjectId);
  const metadata = (subject.metadata ?? {}) as Partial<WorkEvaluationSubjectMetadata>;
  if (typeof metadata.periodId !== "string" || typeof metadata.evaluateeUserId !== "string") {
    throw new BadRequestException(
      `Evaluation subject ${subjectId} is missing periodId/evaluateeUserId metadata (see work-evaluation README).`,
    );
  }
  return metadata as WorkEvaluationSubjectMetadata;
}
