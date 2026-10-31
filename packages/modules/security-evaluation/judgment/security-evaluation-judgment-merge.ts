import type {
  EvaluationCoverageBucket,
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
  EvaluationVerdict,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment } from "@modules/evaluation/ports/judgment.port";

/** One mechanism's judgment, tagged with the mechanism name that produced it. */
export interface SecurityEvaluationJudgmentPart {
  mechanismName: string;
  judgment: EvaluationJudgment;
}

const SEVERITY_RANK: Record<EvaluationFindingSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function higherSeverity(a: EvaluationFindingSeverity, b: EvaluationFindingSeverity): EvaluationFindingSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Shallow metadata merge that keeps existing non-empty values: a later
 * mechanism may add or fill a missing key, never overwrite a fact another
 * mechanism already supplied.
 */
function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) return existing;
  if (!existing) return { ...incoming };
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (isEmptyValue(merged[key]) && !isEmptyValue(value)) merged[key] = value;
  }
  return merged;
}

/**
 * Merge the judgments of the mechanisms declared for one evaluationKey
 * (ADR-046). The contract is enforced here rather than left to convention:
 *
 * - verdicts: one owner per criterionKey. Two mechanisms scoring the same
 *   criterion is fail-fast — a silently weighted score would be unexplainable.
 * - findings: dedupe by fingerprint; severity takes the higher value and
 *   metadata is shallow-merged without overwriting existing non-empty values.
 * - evaluatedRefs: union.
 * - skipped: items unioned and the merged total is the distinct-id count, so
 *   items.length === total holds (evaluation-invariants D5.2); notes prefixed
 *   by mechanism name.
 * - metadata: namespaced by mechanism name so comparability (ADR-023) survives.
 * - summary: non-empty summaries joined in mechanism order.
 */
export function mergeJudgments(parts: readonly SecurityEvaluationJudgmentPart[]): EvaluationJudgment {
  const verdicts: EvaluationVerdict[] = [];
  const verdictOwners = new Map<string, string>();
  const findings = new Map<string, EvaluationFindingCandidate>();
  const evaluatedRefs = new Set<string>();
  const skippedItems = new Set<string>();
  const skippedNotes: string[] = [];
  const metadata: Record<string, unknown> = {};
  const summaries: string[] = [];
  let hasSkipped = false;

  for (const part of parts) {
    for (const verdict of part.judgment.verdicts) {
      const owner = verdictOwners.get(verdict.criterionKey);
      if (owner !== undefined) {
        throw new Error(
          `Criterion "${verdict.criterionKey}" produced verdicts from both "${owner}" and "${part.mechanismName}" (ADR-046 forbids implicit weighting).`,
        );
      }
      verdictOwners.set(verdict.criterionKey, part.mechanismName);
      verdicts.push(verdict);
    }

    for (const finding of part.judgment.findings) {
      const existing = findings.get(finding.fingerprint);
      if (!existing) {
        findings.set(
          finding.fingerprint,
          finding.metadata ? { ...finding, metadata: { ...finding.metadata } } : { ...finding },
        );
        continue;
      }
      findings.set(finding.fingerprint, {
        ...existing,
        severity: higherSeverity(existing.severity, finding.severity),
        metadata: mergeMetadata(existing.metadata, finding.metadata),
      });
    }

    for (const ref of part.judgment.evaluatedRefs) evaluatedRefs.add(ref);

    const skipped = part.judgment.skipped;
    if (skipped) {
      hasSkipped = true;
      for (const item of skipped.items ?? []) skippedItems.add(item);
      if (skipped.note) skippedNotes.push(`${part.mechanismName}: ${skipped.note}`);
    }

    if (part.judgment.metadata !== undefined) metadata[part.mechanismName] = part.judgment.metadata;
    if (part.judgment.summary) summaries.push(part.judgment.summary);
  }

  const merged: EvaluationJudgment = {
    verdicts,
    findings: [...findings.values()],
    evaluatedRefs: [...evaluatedRefs],
  };

  if (hasSkipped) {
    merged.skipped = buildSkippedBucket(skippedItems, skippedNotes);
  }
  if (Object.keys(metadata).length > 0) merged.metadata = metadata;
  if (summaries.length > 0) merged.summary = summaries.join(" ");

  return merged;
}

function buildSkippedBucket(items: Set<string>, notes: string[]): EvaluationCoverageBucket {
  // The skeleton requires items.length === total; two mechanisms skipping the
  // same evidence id is one skipped item, not two.
  const bucket: EvaluationCoverageBucket = { total: items.size };
  if (items.size > 0) bucket.items = [...items];
  if (notes.length > 0) bucket.note = notes.join(" ");
  return bucket;
}
