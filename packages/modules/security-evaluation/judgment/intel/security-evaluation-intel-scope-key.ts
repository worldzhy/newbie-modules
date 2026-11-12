/**
 * The negative-cache scope of one evaluation subject (ADR-058).
 *
 * The subject, not the platform coordinate, identifies the asset: after
 * ADR-039 every run carries the module constant `platform:deployment`, so
 * keying the cache on it would let one asset reuse another asset's
 * "not relevant" verdicts.
 *
 * Both the evidence provider (read side) and the INTEL judgment (write side)
 * must use this helper — two hand-built keys would drift apart and silently
 * disable the cache. The judgment has no subject kind on its input (ADR-037
 * drops it), so callers pass the kind explicitly: the evidence provider has
 * the subject, the judgment has the criteria version, which is published per
 * subject kind (evaluation-run.service resolves it by `subject.kind`).
 */
export function securityEvaluationIntelScopeKey(kind: string, subjectKey: string): string {
  return `${kind}:${subjectKey}`;
}
