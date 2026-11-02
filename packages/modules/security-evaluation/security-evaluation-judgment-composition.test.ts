import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { EvaluationFindingCandidate, EvaluationVerdict } from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import { mergeJudgments } from "./judgment/security-evaluation-judgment-merge";
import { SecurityEvaluationJudgmentService } from "./judgment/security-evaluation-judgment.service";
import {
  SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG,
  SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY,
  SECURITY_EVALUATION_MECHANISM_NAME_INTEL,
  type SecurityEvaluationJudgmentMechanism,
} from "./judgment/security-evaluation-mechanism";
import {
  SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY,
  resolveSecurityEvaluationJudgmentMechanisms,
} from "./judgment/security-evaluation-mechanism.registry";
import {
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
  SECURITY_EVALUATION_KEY_NPM_OSV,
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
} from "./security-evaluation.constants";

/**
 * Composition contract tests (ADR-046): the registry makes "which mechanisms
 * judge this key" a readable structure, and the merge function enforces the
 * five rules that make multi-mechanism results defined behavior.
 */

const EMPTY: EvaluationJudgment = { verdicts: [], findings: [], evaluatedRefs: [] };

function judgment(partial: Partial<EvaluationJudgment>): EvaluationJudgment {
  return { ...EMPTY, ...partial };
}

function finding(fingerprint: string, overrides: Partial<EvaluationFindingCandidate> = {}): EvaluationFindingCandidate {
  return {
    criterionKey: "criterion-x",
    fingerprint,
    severity: "LOW",
    title: "title",
    ...overrides,
  };
}

const VERDICT: EvaluationVerdict = {
  criterionKey: "criterion-x",
  score: 80,
  confidence: "high",
  coverage: { included: 1, skipped: 0 },
  evidenceRefs: ["e-1"],
  rationale: "rationale",
};

function fakeMechanism(name: string, result: EvaluationJudgment = EMPTY): SecurityEvaluationJudgmentMechanism {
  return { name, judge: async () => result };
}

const ALL_MECHANISMS: readonly SecurityEvaluationJudgmentMechanism[] = [
  fakeMechanism(SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY),
  fakeMechanism(SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG),
  fakeMechanism(SECURITY_EVALUATION_MECHANISM_NAME_INTEL),
];

test("registry: every key declares at least one uniquely named mechanism", () => {
  const expectedKeys = [
    SECURITY_EVALUATION_KEY_NPM_OSV,
    SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    SECURITY_EVALUATION_KEY_THREAT_INTEL,
  ];
  assert.deepEqual(Object.keys(SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY).sort(), [...expectedKeys].sort());

  for (const [evaluationKey, names] of Object.entries(SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY)) {
    assert.ok(names.length >= 1, `${evaluationKey} must declare at least one mechanism`);
    assert.equal(new Set(names).size, names.length, `${evaluationKey} declares a duplicate mechanism name`);
  }

  // The shared aws-config mechanism is explicit for both AWS keys.
  assert.deepEqual(SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY[SECURITY_EVALUATION_KEY_AWS_CIS_1_5], [
    SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG,
  ]);
  assert.deepEqual(SECURITY_EVALUATION_JUDGMENT_MECHANISMS_BY_KEY[SECURITY_EVALUATION_KEY_AWS_CUSTOM], [
    SECURITY_EVALUATION_MECHANISM_NAME_AWS_CONFIG,
  ]);
});

test("registry: resolution returns the declared mechanism instances and rejects unknown keys", () => {
  const resolved = resolveSecurityEvaluationJudgmentMechanisms(SECURITY_EVALUATION_KEY_NPM_OSV, ALL_MECHANISMS);
  assert.equal(resolved?.length, 1);
  assert.equal(resolved?.[0].name, SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY);

  assert.equal(resolveSecurityEvaluationJudgmentMechanisms("unknown-key", ALL_MECHANISMS), undefined);
});

test("registry: a declared-but-missing mechanism and a duplicate name are wiring errors", () => {
  assert.throws(
    () => resolveSecurityEvaluationJudgmentMechanisms(SECURITY_EVALUATION_KEY_NPM_OSV, []),
    /unknown judgment mechanism "dependency"/,
  );
  assert.throws(
    () =>
      resolveSecurityEvaluationJudgmentMechanisms(SECURITY_EVALUATION_KEY_NPM_OSV, [
        fakeMechanism(SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY),
        fakeMechanism(SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY),
      ]),
    /Duplicate judgment mechanism name "dependency"/,
  );
});

test("merge: findings dedupe by fingerprint, severity takes the higher value, metadata keeps existing facts", () => {
  const merged = mergeJudgments([
    {
      mechanismName: "a",
      judgment: judgment({
        findings: [
          finding("f-1", { severity: "LOW", metadata: { controlId: "1", confidence: "high" } }),
          finding("f-2", { severity: "INFO" }),
        ],
      }),
    },
    {
      mechanismName: "b",
      judgment: judgment({
        findings: [finding("f-1", { severity: "HIGH", metadata: { controlId: "2", note: "extra" } })],
      }),
    },
  ]);

  assert.equal(merged.findings.length, 2);
  const mergedFirst = merged.findings.find((item) => item.fingerprint === "f-1");
  assert.equal(mergedFirst?.severity, "HIGH");
  assert.equal(mergedFirst?.metadata?.controlId, "1");
  assert.equal(mergedFirst?.metadata?.confidence, "high");
  assert.equal(mergedFirst?.metadata?.note, "extra");
  assert.equal(merged.findings.find((item) => item.fingerprint === "f-2")?.severity, "INFO");
});

test("merge: the same criterionKey from two mechanisms is fail-fast and names both mechanisms", () => {
  assert.throws(
    () =>
      mergeJudgments([
        { mechanismName: "a", judgment: judgment({ verdicts: [VERDICT] }) },
        { mechanismName: "b", judgment: judgment({ verdicts: [VERDICT] }) },
      ]),
    /Criterion "criterion-x" produced verdicts from both "a" and "b"/,
  );
});

test("merge: refs union, skipped totals summed with named notes, metadata namespaced, summaries joined", () => {
  const merged = mergeJudgments([
    {
      mechanismName: "a",
      judgment: judgment({
        evaluatedRefs: ["e-1", "e-2"],
        skipped: { total: 1, items: ["e-3"], note: "budget exhausted" },
        metadata: { model: "m-a" },
        summary: "summary a",
      }),
    },
    {
      mechanismName: "b",
      judgment: judgment({
        evaluatedRefs: ["e-2", "e-4"],
        skipped: { total: 2, items: ["e-5", "e-6"], note: "transport error" },
        metadata: { model: "m-b" },
        summary: "summary b",
      }),
    },
  ]);

  assert.deepEqual(merged.evaluatedRefs, ["e-1", "e-2", "e-4"]);
  assert.equal(merged.skipped?.total, 3);
  assert.deepEqual(merged.skipped?.items, ["e-3", "e-5", "e-6"]);
  assert.equal(merged.skipped?.note, "a: budget exhausted b: transport error");
  assert.deepEqual(merged.metadata, { a: { model: "m-a" }, b: { model: "m-b" } });
  assert.equal(merged.summary, "summary a summary b");
});

test("merge: an evidence id skipped by two mechanisms is counted once so items.length === total", () => {
  const merged = mergeJudgments([
    { mechanismName: "a", judgment: judgment({ skipped: { total: 1, items: ["e-1"], note: "budget exhausted" } }) },
    { mechanismName: "b", judgment: judgment({ skipped: { total: 1, items: ["e-1"], note: "negative cache" } }) },
  ]);

  assert.equal(merged.skipped?.total, 1);
  assert.deepEqual(merged.skipped?.items, ["e-1"]);
  assert.equal(merged.skipped?.note, "a: budget exhausted b: negative cache");
});

test("dispatcher: unknown evaluationKey is a contract error, known keys run their mechanisms", async () => {
  const input = {
    subject: { id: "s-1", scopeType: "project", scopeId: "p-1", subjectKey: "k", displayName: "k" },
    ruleSetVersion: { id: "v-1", kind: "repository", evaluationKey: SECURITY_EVALUATION_KEY_NPM_OSV, version: "v1" },
    criteria: [],
    evidence: [],
    runConfig: null,
  } as JudgmentInput;

  const dependency = fakeMechanism(
    SECURITY_EVALUATION_MECHANISM_NAME_DEPENDENCY,
    judgment({ evaluatedRefs: ["e-1"], summary: "dependency judged" }),
  );
  const service = new SecurityEvaluationJudgmentService([dependency]);

  const result = await service.judge(input);
  assert.deepEqual(result.evaluatedRefs, ["e-1"]);
  assert.equal(result.summary, "dependency judged");

  await assert.rejects(
    () => service.judge({ ...input, ruleSetVersion: { ...input.ruleSetVersion, evaluationKey: "unknown-key" } }),
    (error: unknown) => error instanceof BadRequestException,
  );
});
