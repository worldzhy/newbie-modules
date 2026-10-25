import type { EvaluationScope, EvaluationSubjectDescriptor } from "./evaluation.contracts";

/**
 * SubjectProvider (ADR-020 D4) — implemented by the host, which owns the
 * identity system and therefore the meaning of `scopeType` / `scopeId`.
 *
 * The skeleton never enumerates subjects on its own: it syncs whatever the
 * host declares for a scope and kind. One provider serves every kind the host
 * exposes (a host that evaluates members and repositories returns both).
 */
export const subjectProviderToken = "EVALUATION_SUBJECT_PROVIDER";

export interface SubjectProvider {
  listSubjects(scope: EvaluationScope, kind: string): Promise<EvaluationSubjectDescriptor[]>;
}
