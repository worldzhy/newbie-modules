import { createHash } from "node:crypto";

import type {
  EvaluationCoverageBucket,
  EvaluationCoverageStats,
  EvaluationCriterionRef,
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
  EvaluationVerdict,
} from "./ports/evaluation.contracts";

/**
 * The executable form of ADR-020 D5. Every rule here is pure so it can be
 * tested without a database, and every service that persists a snapshot runs
 * these checks before writing.
 *
 * Validation functions return the list of problems instead of throwing: the
 * service layer decides the transport-level reaction, the skeleton decides what
 * is legal.
 */

/**
 * Stable serialization: object keys sorted at every depth, dates as ISO
 * strings, undefined dropped. Two manifests with equal content hash to the same
 * bytes regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    sorted[key] = canonicalize(record[key]);
  }
  return sorted;
}

/** SHA-256 over the canonical manifest (ADR-020 D5.1). */
export function hashManifest(manifest: readonly EvaluationEvidenceItem[]): string {
  return createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex");
}

/** A version is editable only while it is a draft (ADR-020 D5.5). */
export function isCriteriaVersionMutable(publishedAt: Date | null | undefined): boolean {
  return publishedAt === null || publishedAt === undefined;
}

export interface ComposeCoverageInput {
  /** Evidence collected for the run, used to attribute evaluated ids to sources. */
  items: readonly EvaluationEvidenceItem[];
  /** Evidence ids the judgment examined. */
  evaluatedRefs: readonly string[];
  declaredUnlinked: EvaluationCoverageBucket;
  /** Skipped buckets of the run: collector first, then judgment budget. */
  skippedBuckets: readonly (EvaluationCoverageBucket | undefined)[];
}

export interface ComposeCoverageResult {
  stats: EvaluationCoverageStats;
  /**
   * Evaluated refs that name no collected item. Non-empty means the judgment
   * examined material that is not in the manifest — the caller must reject the
   * run rather than archive an unattributable coverage claim.
   */
  problems: string[];
}

/**
 * Compose the three coverage buckets of a result (ADR-020 D5.2). The evaluated
 * bucket is derived from what the judgment actually examined, never asserted by
 * the caller; skipped buckets are merged so no source of dropped material can
 * disappear. An evaluated ref unknown to the manifest is reported as a problem
 * instead of being silently bucketed under an "unknown" source.
 */
export function composeCoverageStats(input: ComposeCoverageInput): ComposeCoverageResult {
  const evaluatedRefs = [...new Set(input.evaluatedRefs)];
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const bySource: Record<string, number> = {};
  const problems: string[] = [];
  for (const ref of evaluatedRefs) {
    const item = byId.get(ref);
    if (!item) {
      problems.push(`evaluated ref ${ref} is not part of the collected evidence`);
      continue;
    }
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
  }
  return {
    stats: {
      evaluated: { total: evaluatedRefs.length, bySource, items: evaluatedRefs },
      declaredUnlinked: normalizeBucket(input.declaredUnlinked),
      skipped: mergeBuckets(input.skippedBuckets),
    },
    problems,
  };
}

function normalizeBucket(bucket: EvaluationCoverageBucket): EvaluationCoverageBucket {
  const normalized: EvaluationCoverageBucket = { total: bucket.total };
  if (bucket.bySource) normalized.bySource = { ...bucket.bySource };
  if (bucket.note) normalized.note = bucket.note;
  if (bucket.items) normalized.items = [...bucket.items];
  return normalized;
}

function mergeBuckets(buckets: readonly (EvaluationCoverageBucket | undefined)[]): EvaluationCoverageBucket {
  const present = buckets.filter((bucket): bucket is EvaluationCoverageBucket => Boolean(bucket));
  if (present.length === 0) return { total: 0 };
  const merged: EvaluationCoverageBucket = { total: 0 };
  const bySource: Record<string, number> = {};
  const items: string[] = [];
  const notes: string[] = [];
  for (const bucket of present) {
    merged.total += bucket.total;
    for (const [source, count] of Object.entries(bucket.bySource ?? {})) {
      bySource[source] = (bySource[source] ?? 0) + count;
    }
    if (bucket.items) items.push(...bucket.items);
    if (bucket.note) notes.push(bucket.note);
  }
  if (Object.keys(bySource).length > 0) merged.bySource = bySource;
  // Not deduplicated: one entry per skipped count, so items.length === total
  // stays checkable by validateCoverageStats.
  if (items.length > 0) merged.items = items;
  if (notes.length > 0) merged.note = notes.join("; ");
  return merged;
}

/**
 * Problems that make a coverage snapshot unacceptable (ADR-020 D5.2). When
 * `manifestIds` is given, every evaluated item must be part of the archived
 * manifest — an evaluated ref that is not cannot be attributed to a source.
 */
export function validateCoverageStats(stats: EvaluationCoverageStats, manifestIds?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const name of ["evaluated", "declaredUnlinked", "skipped"] as const) {
    const bucket = stats?.[name];
    if (!bucket) {
      problems.push(`coverageStats.${name} is required`);
      continue;
    }
    problems.push(...validateBucket(name, bucket));
  }
  if (stats?.evaluated?.items && manifestIds) {
    for (const ref of stats.evaluated.items) {
      if (!manifestIds.has(ref)) {
        problems.push(`coverageStats.evaluated references ${ref} which is not in the manifest`);
      }
    }
  }
  return problems;
}

function validateBucket(name: string, bucket: EvaluationCoverageBucket): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(bucket.total) || bucket.total < 0) {
    problems.push(`coverageStats.${name}.total must be a non-negative integer`);
  }
  if (bucket.bySource) {
    const sum = Object.values(bucket.bySource).reduce((total, count) => total + count, 0);
    if (sum !== bucket.total) {
      problems.push(`coverageStats.${name}.bySource sums to ${sum}, expected ${bucket.total}`);
    }
  }
  // Skipped material is the case D5.2 exists for: a count alone is not an
  // explanation, and the dropped items must be identifiable.
  if (name === "skipped" && bucket.total > 0) {
    if (!bucket.note) problems.push("coverageStats.skipped requires a note explaining the cut-off");
    if (!bucket.items || bucket.items.length === 0) {
      problems.push("coverageStats.skipped must list the dropped item ids");
    }
  }
  if (name === "skipped" && bucket.items && bucket.items.length !== bucket.total) {
    problems.push(`coverageStats.skipped.items lists ${bucket.items.length} ids but total is ${bucket.total}`);
  }
  if (name === "declaredUnlinked" && bucket.total > 0 && !bucket.note) {
    problems.push("coverageStats.declaredUnlinked requires a note explaining the gap");
  }
  return problems;
}

/**
 * Judgment consistency: verdicts belong to SCORED criteria, findings belong to
 * ASSERTION criteria, and every reference resolves inside the version
 * (ADR-020 D2). Findings stay out of the result, so a scored criterion cannot
 * smuggle one in and vice versa. When `evidenceIds` is given, every
 * `evidenceRefs` entry of a verdict or finding must name a manifest item —
 * citing material that was never collected is a judgment defect.
 */
export function validateJudgment(input: {
  criteria: readonly EvaluationCriterionRef[];
  verdicts: readonly EvaluationVerdict[];
  findings: readonly EvaluationFindingCandidate[];
  /** Ids of the run's manifest items; when set, evidence refs must resolve. */
  evidenceIds?: ReadonlySet<string>;
}): string[] {
  const problems: string[] = [];
  const criteria = new Map(input.criteria.map((criterion) => [criterion.criterionKey, criterion]));

  const seenVerdicts = new Set<string>();
  for (const verdict of input.verdicts) {
    const criterion = criteria.get(verdict.criterionKey);
    if (!criterion) {
      problems.push(`verdict ${verdict.criterionKey} is not a criterion of the version`);
      continue;
    }
    if (criterion.kind !== "SCORED") {
      problems.push(`verdict ${verdict.criterionKey} targets ASSERTION criterion`);
    }
    if (seenVerdicts.has(verdict.criterionKey)) {
      problems.push(`verdict ${verdict.criterionKey} appears more than once`);
    }
    seenVerdicts.add(verdict.criterionKey);
    if (!Number.isFinite(verdict.score)) {
      problems.push(`verdict ${verdict.criterionKey} has a non-finite score`);
    }
    if (input.evidenceIds) {
      for (const ref of verdict.evidenceRefs) {
        if (!input.evidenceIds.has(ref)) {
          problems.push(`verdict ${verdict.criterionKey} references unknown evidence ${ref}`);
        }
      }
    }
  }

  const seenFindings = new Set<string>();
  for (const finding of input.findings) {
    const criterion = criteria.get(finding.criterionKey);
    if (!criterion) {
      problems.push(`finding ${finding.criterionKey} is not a criterion of the version`);
      continue;
    }
    if (criterion.kind !== "ASSERTION") {
      problems.push(`finding ${finding.criterionKey} targets SCORED criterion`);
    }
    if (!finding.fingerprint) {
      problems.push(`finding ${finding.criterionKey} has no fingerprint`);
    }
    const identity = `${finding.criterionKey}/${finding.fingerprint}`;
    if (seenFindings.has(identity)) {
      problems.push(`finding ${identity} appears more than once`);
    }
    seenFindings.add(identity);
    if (input.evidenceIds) {
      for (const ref of finding.evidenceRefs ?? []) {
        if (!input.evidenceIds.has(ref)) {
          problems.push(`finding ${finding.criterionKey} references unknown evidence ${ref}`);
        }
      }
    }
  }

  return problems;
}
