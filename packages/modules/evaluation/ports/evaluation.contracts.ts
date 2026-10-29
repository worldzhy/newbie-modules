/**
 * Value shapes shared by the four evaluation ports (ADR-020 D4) and by the
 * services that persist them.
 *
 * Everything here is feature-neutral and host-neutral: no Prisma types, no
 * host vocabulary. A feature describes its subjects, evidence and judgments in
 * these shapes; the skeleton stores them and enforces the invariants.
 */

/** The host-assigned coordinate that bounds a subject listing (ADR-020 D1). */
export interface EvaluationScope {
  scopeType: string;
  scopeId: string;
}

/**
 * A subject as its feature describes it. `subjectKey` is the feature's stable
 * natural identity inside the scope — the skeleton never derives it.
 */
export interface EvaluationSubjectDescriptor {
  kind: string;
  scopeType: string;
  scopeId: string;
  subjectKey: string;
  displayName: string;
  metadata?: Record<string, unknown>;
}

/** A stored subject, detached from Prisma. */
export interface EvaluationSubjectRef {
  id: string;
  kind: string;
  scopeType: string;
  scopeId: string;
  subjectKey: string;
  displayName: string;
}

/** A published criteria version, detached from Prisma. */
export interface EvaluationRuleSetVersionRef {
  id: string;
  kind: string;
  evaluationKey: string;
  version: string;
}

export type EvaluationCriterionKind = "SCORED" | "ASSERTION";

/** One criterion of a version, in the shape the judgment port consumes. */
export interface EvaluationCriterionRef {
  criterionKey: string;
  kind: EvaluationCriterionKind;
  name: string;
  metadata?: Record<string, unknown> | null;
}

/** One piece of material a run is judged from. */
export interface EvaluationEvidenceItem {
  /** Stable inside the run; verdicts and findings reference it. */
  id: string;
  /** Evidence layer, e.g. "fact" | "declared" — feature-defined. */
  layer: string;
  /** Feature-defined origin, e.g. "workspace" | "lockfile" | "aws-account". */
  source: string;
  summary: string;
  observedAt: Date;
  refs?: string[];
  payload?: Record<string, unknown>;
}

/**
 * One coverage bucket. `total > 0` requires an explanation (`note`) and, for
 * skipped material, the dropped item ids — ADR-020 D5.2 forbids silently
 * dropping evidence.
 */
export interface EvaluationCoverageBucket {
  total: number;
  bySource?: Record<string, number>;
  note?: string;
  items?: string[];
}

/**
 * The coverage contract of a result: what was judged, what was declared but
 * could not be linked to fact-layer material, and what a budget cut off.
 */
export type EvaluationCoverageStats = {
  evaluated: EvaluationCoverageBucket;
  declaredUnlinked: EvaluationCoverageBucket;
  skipped: EvaluationCoverageBucket;
};

export type EvaluationConfidence = "high" | "medium" | "low";

/** A verdict is the product of a SCORED criterion (ADR-020 D2). */
export interface EvaluationVerdict {
  criterionKey: string;
  score: number;
  confidence: EvaluationConfidence;
  coverage: { included: number; skipped: number; note?: string };
  evidenceRefs: string[];
  rationale: string;
  unresolved?: string[];
}

export type EvaluationFindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** A finding candidate is the product of an ASSERTION criterion (ADR-020 D2). */
export interface EvaluationFindingCandidate {
  criterionKey: string;
  /** Feature-defined stable identity of the problem inside its subject. */
  fingerprint: string;
  severity: EvaluationFindingSeverity;
  title: string;
  detail?: string;
  evidenceRefs?: string[];
  metadata?: Record<string, unknown>;
}
