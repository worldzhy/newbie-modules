import type { EvidenceSourceType } from "./people-evidence-source-type";

/**
 * v0.x machine scoring for PeopleEvaluationEvidence → PeopleEvaluationScore.
 *
 * The design goal is "simple, defensible, traceable" — no black box.
 * Every score is a deterministic function of the evidence rows and the
 * rubric's dimension anchors. All inputs are frozen snapshots at scoring
 * time so the decision trail is replayable.
 */

export interface ScoringInputEvidence {
  id: string;
  dimensionKey: string | null;
  sourceType: EvidenceSourceType;
}

export interface ScoringInputDimension {
  dimensionKey: string;
  anchorLow: number | null;
  anchorHigh: number | null;
}

export interface DimensionScoreResult {
  dimensionKey: string;
  score: number;
  evidenceRefs: string[]; // frozen ids at scoring time
}

/**
 * Quality weight per EvidenceSourceType. GIT is the highest-confidence
 * signal (actual code written), INCIDENT is weaker (could be on-call),
 * WORK_DELIVERABLE is strongest (intentional output). v0.x only GIT is
 * wired; weights are declared up front so future collectors plug in.
 */
const QUALITY_BY_SOURCE_TYPE: Record<ScoringInputEvidence["sourceType"], number> = {
  GIT: 1.0,
  WORK_DELIVERABLE: 1.2,
  INCIDENT: 0.7,
  TEST_TREND: 0.8,
};

/** v0.x empirical ceiling: 50 weighted commits per dimension ≈ full Senior load. */
const EVIDENCE_CAP = 50;

/**
 * Compute per-dimension scores from a flat evidence list + rubric
 * dimensions. Pure function — no DB access, no side effects.
 *
 * Caller supplies all evidences for one evaluateeUserId + one collection
 * period; caller also supplies the rubric's dimension snapshot so anchors
 * are frozen at scoring time.
 */
export function computeDimensionScores(
  evidences: ScoringInputEvidence[],
  dimensions: ScoringInputDimension[],
  options: {
    /** Cap per-dimension weighted count. Default 50. */
    cap?: number;
    /** Whether to clamp score inside rubric [anchorLow, anchorHigh]. Default true. */
    clampToAnchors?: boolean;
  } = {},
): DimensionScoreResult[] {
  const cap = options.cap ?? EVIDENCE_CAP;
  const clampToAnchors = options.clampToAnchors ?? true;
  const maxLog = Math.log1p(cap);

  // 1. Bucket evidences by dimensionKey (null = uncategorized)
  const categorized = new Map<string, ScoringInputEvidence[]>();
  const uncategorized: ScoringInputEvidence[] = [];
  for (const evidence of evidences) {
    if (evidence.dimensionKey) {
      const bucket = categorized.get(evidence.dimensionKey) ?? [];
      bucket.push(evidence);
      categorized.set(evidence.dimensionKey, bucket);
    } else {
      uncategorized.push(evidence);
    }
  }

  // 2. Evenly distribute uncategorized evidence across rubric dimensions.
  //    Each dimension gets at least floor share; remainder assigned in round-robin.
  const dimensionKeys = dimensions.map((dimension) => dimension.dimensionKey);
  const baseShare = Math.floor(uncategorized.length / dimensionKeys.length);
  const remainder = uncategorized.length % dimensionKeys.length;

  const evidenceByDimension = new Map<string, ScoringInputEvidence[]>();
  for (const key of dimensionKeys) {
    const bucket: ScoringInputEvidence[] = [...(categorized.get(key) ?? [])];
    evidenceByDimension.set(key, bucket);
  }
  for (let i = 0; i < dimensionKeys.length; i++) {
    const share = baseShare + (i < remainder ? 1 : 0);
    const slice = uncategorized.splice(0, share);
    const bucket = evidenceByDimension.get(dimensionKeys[i])!;
    bucket.push(...slice);
  }

  // 3. Compute per-dimension weighted count + score
  const results: DimensionScoreResult[] = [];
  for (const dimension of dimensions) {
    const bucket = evidenceByDimension.get(dimension.dimensionKey) ?? [];
    if (bucket.length === 0) continue; // no evidence at all → skip (dimension not applicable yet)

    let weightedCount = 0;
    const evidenceRefs: string[] = [];
    for (const evidence of bucket) {
      weightedCount += QUALITY_BY_SOURCE_TYPE[evidence.sourceType] ?? 1.0;
      evidenceRefs.push(evidence.id);
    }

    const normalized = clamp(Math.log1p(weightedCount) / maxLog, 0, 1);
    let score = 50 + normalized * 50;

    if (clampToAnchors && dimension.anchorLow != null && dimension.anchorHigh != null) {
      score = clamp(score, dimension.anchorLow, dimension.anchorHigh);
    }

    results.push({
      dimensionKey: dimension.dimensionKey,
      score: Math.round(score * 100) / 100,
      evidenceRefs,
    });
  }

  return results;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
