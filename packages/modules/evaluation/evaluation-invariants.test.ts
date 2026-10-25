import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalJson,
  composeCoverageStats,
  hashManifest,
  isCriteriaVersionMutable,
  validateCoverageStats,
  validateJudgment,
} from "./evaluation-invariants";
import type {
  EvaluationCoverageStats,
  EvaluationCriterionRef,
  EvaluationEvidenceItem,
  EvaluationVerdict,
} from "./ports/evaluation.contracts";

/**
 * Contract tests for the ADR-020 D5 invariants that are decided before a write.
 *
 * The two remaining invariants are enforced elsewhere and are verified
 * separately: snapshot immutability by the absence of any update path on
 * EvaluationResultService, and run concurrency by the partial unique index the
 * consumer migration declares in raw SQL (Prisma cannot express it).
 */

const EVIDENCE: EvaluationEvidenceItem[] = [
  {
    id: "e1",
    layer: "fact",
    source: "lockfile",
    summary: "lodash 4.17.20",
    observedAt: new Date("2026-10-01T00:00:00Z"),
  },
  {
    id: "e2",
    layer: "fact",
    source: "lockfile",
    summary: "express 4.18.2",
    observedAt: new Date("2026-10-01T00:00:00Z"),
  },
  {
    id: "e3",
    layer: "declared",
    source: "document",
    summary: "design note",
    observedAt: new Date("2026-10-01T00:00:00Z"),
  },
];

const BASE_COVERAGE: EvaluationCoverageStats = {
  evaluated: { total: 0 },
  declaredUnlinked: { total: 0 },
  skipped: { total: 0 },
};

describe("manifest content hash (ADR-020 D5.1)", () => {
  it("hashes equal content to the same value regardless of key order", () => {
    const a = [{ id: "e1", layer: "fact", source: "lockfile", summary: "x", observedAt: "2026-10-01T00:00:00.000Z" }];
    const b = [{ source: "lockfile", summary: "x", observedAt: "2026-10-01T00:00:00.000Z", layer: "fact", id: "e1" }];

    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(
      hashManifest(a as unknown as EvaluationEvidenceItem[]),
      hashManifest(b as unknown as EvaluationEvidenceItem[]),
    );
  });

  it("changes when the snapshot changes — a rerun cannot reuse an old hash", () => {
    const first = hashManifest(EVIDENCE);
    const second = hashManifest(EVIDENCE.slice(0, 2));

    assert.match(first, /^[0-9a-f]{64}$/);
    assert.notEqual(first, second);
  });
});

describe("criteria version publication (ADR-020 D5.5)", () => {
  it("keeps drafts editable and freezes published versions", () => {
    assert.equal(isCriteriaVersionMutable(null), true);
    assert.equal(isCriteriaVersionMutable(undefined), true);
    assert.equal(isCriteriaVersionMutable(new Date("2026-10-01T00:00:00Z")), false);
  });
});

describe("coverage composition (ADR-020 D5.2)", () => {
  it("derives the evaluated bucket from what the judgment examined, not from a caller count", () => {
    const stats = composeCoverageStats({
      items: EVIDENCE,
      evaluatedRefs: ["e1", "e2", "e2"],
      declaredUnlinked: { total: 1, note: "design note has no fact link" },
      skippedBuckets: [],
    });

    assert.equal(stats.evaluated.total, 2);
    assert.deepEqual(stats.evaluated.bySource, { lockfile: 2 });
    assert.deepEqual(stats.evaluated.items, ["e1", "e2"]);
    assert.equal(stats.skipped.total, 0);
  });

  it("merges collector and judgment cut-offs instead of letting one overwrite the other", () => {
    const stats = composeCoverageStats({
      items: EVIDENCE,
      evaluatedRefs: ["e1"],
      declaredUnlinked: { total: 0 },
      skippedBuckets: [
        { total: 1, note: "registry unreachable", items: ["e2"] },
        { total: 2, note: "judgment budget", items: ["e3", "e4"] },
      ],
    });

    assert.equal(stats.skipped.total, 3);
    assert.deepEqual(stats.skipped.items, ["e2", "e3", "e4"]);
    assert.match(stats.skipped.note ?? "", /registry unreachable/);
    assert.match(stats.skipped.note ?? "", /judgment budget/);
  });

  it("rejects a skipped bucket that counts cut-off material without naming it", () => {
    const silent = { ...BASE_COVERAGE, skipped: { total: 3 } };
    const problems = validateCoverageStats(silent);

    assert.ok(problems.some((problem) => problem.includes("note")));
    assert.ok(problems.some((problem) => problem.includes("dropped item ids")));
  });

  it("rejects an unexplained declared-unlinked gap and inconsistent source counts", () => {
    const bad = {
      evaluated: { total: 2, bySource: { lockfile: 1 } },
      declaredUnlinked: { total: 1 },
      skipped: { total: 0 },
    };
    const problems = validateCoverageStats(bad);

    assert.ok(problems.some((problem) => problem.includes("sums to 1")));
    assert.ok(problems.some((problem) => problem.includes("declaredUnlinked")));
  });

  it("accepts a fully covered run", () => {
    const stats = composeCoverageStats({
      items: EVIDENCE,
      evaluatedRefs: ["e1", "e2", "e3"],
      declaredUnlinked: { total: 0 },
      skippedBuckets: [],
    });

    assert.deepEqual(validateCoverageStats(stats), []);
  });
});

describe("judgment consistency (ADR-020 D2)", () => {
  const criteria: EvaluationCriterionRef[] = [
    { criterionKey: "architecture", kind: "SCORED", name: "Architecture" },
    { criterionKey: "missing-tests", kind: "ASSERTION", name: "Missing tests" },
  ];

  const verdict = (criterionKey: string): EvaluationVerdict => ({
    criterionKey,
    score: 3,
    confidence: "medium",
    coverage: { included: 2, skipped: 0 },
    evidenceRefs: ["e1"],
    rationale: "matches the anchors",
  });

  it("accepts verdicts on scored criteria and findings on assertion criteria", () => {
    const problems = validateJudgment({
      criteria,
      verdicts: [verdict("architecture")],
      findings: [
        {
          criterionKey: "missing-tests",
          fingerprint: "module:map",
          severity: "MEDIUM",
          title: "Module map has no tests",
        },
      ],
    });

    assert.deepEqual(problems, []);
  });

  it("refuses to put a scored conclusion into the finding lifecycle", () => {
    const problems = validateJudgment({
      criteria,
      verdicts: [],
      findings: [{ criterionKey: "architecture", fingerprint: "arch", severity: "LOW", title: "Architecture" }],
    });

    assert.ok(problems.some((problem) => problem.includes("targets SCORED criterion")));
  });

  it("refuses a verdict on an assertion criterion and unknown criterion keys", () => {
    const problems = validateJudgment({
      criteria,
      verdicts: [verdict("missing-tests"), verdict("does-not-exist")],
      findings: [],
    });

    assert.ok(problems.some((problem) => problem.includes("targets ASSERTION criterion")));
    assert.ok(problems.some((problem) => problem.includes("not a criterion of the version")));
  });

  it("rejects duplicate verdicts and duplicate finding fingerprints", () => {
    const problems = validateJudgment({
      criteria,
      verdicts: [verdict("architecture"), verdict("architecture")],
      findings: [
        { criterionKey: "missing-tests", fingerprint: "same", severity: "HIGH", title: "a" },
        { criterionKey: "missing-tests", fingerprint: "same", severity: "HIGH", title: "b" },
      ],
    });

    assert.ok(problems.some((problem) => problem.includes("appears more than once")));
    assert.ok(problems.some((problem) => problem.includes("missing-tests/same")));
  });
});
