import type { EvidenceSourceType } from "./people-evidence-source-type";

/**
 * v0.x machine scoring for PeopleEvaluationEvidence → PeopleEvaluationScore.
 *
 * The design goal is "simple, defensible, traceable" — no black box.
 * Every score is a deterministic function of the evidence rows, the
 * rubric's dimension anchors and the evaluatee's declared weights. All
 * inputs are frozen snapshots at scoring time so the decision trail is
 * replayable.
 */

export interface ScoringInputEvidence {
  id: string;
  dimensionKey: string | null;
  sourceType: EvidenceSourceType;
  /**
   * Signed weighted contribution produced by the collector. INCIDENT owned
   * by the evaluatee arrives negative (caused); handled incidents are
   * positive. When omitted the source-type quality weight is used.
   */
  contribution?: number;
  /** Source payload — read by deriveEvidenceContribution for direction. */
  payload?: Record<string, unknown>;
}

export interface ScoringInputDimension {
  dimensionKey: string;
  anchorLow: number | null;
  anchorHigh: number | null;
}

export interface DimensionScoreResult {
  dimensionKey: string;
  score: number;
  /** Weight applied to this dimension when computing the composite score. */
  weight: number;
  evidenceRefs: string[]; // frozen ids at scoring time
}

export interface ScoringResult {
  dimensions: DimensionScoreResult[];
  /** Σ(dimension score × weight). */
  compositeScore: number;
  /** Effective weights per dimension (declared or equal split). */
  weights: Record<string, number>;
  /** Evidence keys not present in the rubric — folded into the uncategorized pool. */
  unknownDimensionKeys: string[];
  uncategorizedEvidenceCount: number;
}

/**
 * Quality weight per EvidenceSourceType for positive evidence. GIT is the
 * highest-confidence signal (actual code written), INCIDENT direction is
 * decided by payload role (see deriveEvidenceContribution), WORK_DELIVERABLE
 * is the strongest (intentional output).
 */
const QUALITY_BY_SOURCE_TYPE: Record<EvidenceSourceType, number> = {
  GIT: 1.0,
  WORK_DELIVERABLE: 1.2,
  INCIDENT: 0.7,
  TEST_TREND: 0.8,
};

/** Empirical ceiling: 50 weighted commits per dimension ≈ full Senior load. */
export const DEFAULT_EVIDENCE_CAP = 50;

/** Neutral score baseline: zero net contribution lands here. */
export const DEFAULT_SCORE_FLOOR = 50;

/** Owner-attributed incidents count against the dimension. */
export const INCIDENT_CAUSED_CONTRIBUTION = -0.7;

/** Incidents handled by the evaluatee count for it (on-call evidence). */
export const INCIDENT_HANDLED_CONTRIBUTION = 0.7;

/**
 * Resolve the signed contribution of one evidence row.
 *
 * INCIDENT is direction-aware: `payload.role === "handled"` is positive,
 * anything else (including the legacy rows without role) is treated as
 * caused — the conservative direction for evaluation purposes.
 */
export function deriveEvidenceContribution(evidence: {
  sourceType: EvidenceSourceType;
  payload?: Record<string, unknown>;
}): number {
  if (evidence.sourceType === "INCIDENT") {
    return evidence.payload?.role === "handled" ? INCIDENT_HANDLED_CONTRIBUTION : INCIDENT_CAUSED_CONTRIBUTION;
  }
  return QUALITY_BY_SOURCE_TYPE[evidence.sourceType] ?? 1.0;
}

/**
 * Compute per-dimension scores from a flat evidence list + rubric
 * dimensions + declared weights. Pure function — no DB access, no side
 * effects, order-independent (evidences are sorted by id first).
 *
 * Caller supplies all evidences for one evaluateeUserId + one collection
 * period; caller also supplies the rubric's dimension snapshot so anchors
 * are frozen at scoring time.
 */
export function computeDimensionScores(
  evidences: ScoringInputEvidence[],
  dimensions: ScoringInputDimension[],
  options: {
    /** Declared weight per dimension. Missing keys receive the equal share 1/N. */
    weights?: Record<string, number>;
    /** Cap per-dimension weighted contribution. Default 50. */
    cap?: number;
    /** Baseline for zero net contribution. Default 50. */
    scoreFloor?: number;
    /** Whether to clamp score inside rubric [anchorLow, anchorHigh]. Default true. */
    clampToAnchors?: boolean;
  } = {},
): ScoringResult {
  const cap = Math.max(options.cap ?? DEFAULT_EVIDENCE_CAP, 1);
  const scoreFloor = options.scoreFloor ?? DEFAULT_SCORE_FLOOR;
  const clampToAnchors = options.clampToAnchors ?? true;
  const maxLog = Math.log1p(cap);

  const dimensionKeys = dimensions.map((dimension) => dimension.dimensionKey);
  if (dimensionKeys.length === 0) {
    return {
      dimensions: [],
      compositeScore: 0,
      weights: {},
      unknownDimensionKeys: [],
      uncategorizedEvidenceCount: evidences.length,
    };
  }

  // 1. Bucket evidences by dimensionKey. Unknown keys are folded into the
  //    uncategorized pool instead of being silently dropped (diagnostics
  //    keep the rubric-drift visible).
  const knownKeys = new Set(dimensionKeys);
  const unknownDimensionKeys = new Set<string>();
  const categorized = new Map<string, ScoringInputEvidence[]>();
  const uncategorized: ScoringInputEvidence[] = [];
  const sortedEvidences = [...evidences].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const evidence of sortedEvidences) {
    if (evidence.dimensionKey && knownKeys.has(evidence.dimensionKey)) {
      const bucket = categorized.get(evidence.dimensionKey) ?? [];
      bucket.push(evidence);
      categorized.set(evidence.dimensionKey, bucket);
    } else {
      if (evidence.dimensionKey) {
        unknownDimensionKeys.add(evidence.dimensionKey);
      }
      uncategorized.push(evidence);
    }
  }

  // 2. Evenly distribute uncategorized evidence across rubric dimensions.
  const baseShare = Math.floor(uncategorized.length / dimensionKeys.length);
  const remainder = uncategorized.length % dimensionKeys.length;
  const evidenceByDimension = new Map<string, ScoringInputEvidence[]>();
  for (const key of dimensionKeys) {
    evidenceByDimension.set(key, [...(categorized.get(key) ?? [])]);
  }
  for (let i = 0; i < dimensionKeys.length; i++) {
    const share = baseShare + (i < remainder ? 1 : 0);
    const slice = uncategorized.splice(0, share);
    evidenceByDimension.get(dimensionKeys[i])!.push(...slice);
  }

  // 3. Compute per-dimension weighted contribution + signed score
  const equalWeight = 1 / dimensionKeys.length;
  const weights: Record<string, number> = {};
  for (const key of dimensionKeys) {
    weights[key] = options.weights?.[key] ?? equalWeight;
  }

  const results: DimensionScoreResult[] = [];
  for (const dimension of dimensions) {
    const bucket = evidenceByDimension.get(dimension.dimensionKey) ?? [];
    if (bucket.length === 0) continue; // no evidence at all → skip (dimension not applicable yet)

    let contribution = 0;
    const evidenceRefs: string[] = [];
    for (const evidence of bucket) {
      contribution += evidence.contribution ?? deriveEvidenceContribution(evidence);
      evidenceRefs.push(evidence.id);
    }

    const direction = contribution > 0 ? 1 : contribution < 0 ? -1 : 0;
    const magnitude = Math.min(1, Math.log1p(Math.abs(contribution)) / maxLog);
    let score = scoreFloor + (100 - scoreFloor) * direction * magnitude;

    if (clampToAnchors && dimension.anchorLow != null && dimension.anchorHigh != null) {
      score = clamp(score, dimension.anchorLow, dimension.anchorHigh);
    }

    results.push({
      dimensionKey: dimension.dimensionKey,
      score: round2(score),
      weight: weights[dimension.dimensionKey],
      evidenceRefs,
    });
  }

  const compositeScore = round2(results.reduce((sum, result) => sum + result.score * result.weight, 0));

  return {
    dimensions: results,
    compositeScore,
    weights,
    unknownDimensionKeys: [...unknownDimensionKeys].sort(),
    uncategorizedEvidenceCount: sortedEvidences.filter(
      (evidence) => !evidence.dimensionKey || !knownKeys.has(evidence.dimensionKey),
    ).length,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
