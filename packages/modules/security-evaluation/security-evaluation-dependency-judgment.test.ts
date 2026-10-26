import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationEvidenceItem } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import { SecurityEvaluationDependencyJudgment } from "./judgment/dependency/security-evaluation-dependency.judgment";
import type {
  OsvBatchOutcome,
  OsvVulnerability,
  SecurityEvaluationOsvClient,
} from "./judgment/dependency/security-evaluation-osv.client";

/**
 * Behavior-level tests for the DEPENDENCY judgment's coverage contract
 * (ADR-020 D5.2, ADR-022 D3): material OSV could not reach is reported as
 * skipped with a reason instead of being counted clean, and a run that reached
 * nothing fails instead of reporting a vacuous clean result.
 */

function evidenceItem(name: string, version: string, isDev = false): EvaluationEvidenceItem {
  return {
    id: `pkg:npm:${name}@${version}`,
    layer: "fact",
    source: "lockfile",
    summary: `${name}@${version}`,
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { name, version, ecosystem: "npm", isDev },
  };
}

function inputFor(items: EvaluationEvidenceItem[]): JudgmentInput {
  return {
    subject: {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "repository",
      scopeType: "project",
      scopeId: "22222222-2222-4222-8222-222222222222",
      subjectKey: "repo",
      displayName: "repo",
    },
    criteriaVersion: {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "repository",
      family: "dependency-osv",
      version: "1",
    },
    criteria: [],
    evidence: items,
    runConfig: null,
  };
}

function stubOsv(
  outcome: OsvBatchOutcome,
  details: Map<string, OsvVulnerability | null> = new Map(),
): SecurityEvaluationOsvClient {
  return {
    queryPackages: async () => outcome,
    fetchDetails: async () => details,
  } as unknown as SecurityEvaluationOsvClient;
}

test("packages whose OSV query failed are skipped with a reason and the run still completes", async () => {
  const reachable = evidenceItem("lodash", "4.17.20");
  const unreachable = evidenceItem("left-pad", "1.3.0");
  const osv = stubOsv(
    {
      vulnerabilitiesByPackageKey: new Map([["lodash@4.17.20", [{ id: "GHSA-aaaa-bbbb-cccc" }]]]),
      failedPackageKeys: ["left-pad@1.3.0"],
      failureNote: "HTTP 503",
    },
    new Map([
      [
        "GHSA-aaaa-bbbb-cccc",
        { summary: "Prototype pollution", database_specific: { severity: "HIGH" }, affected: [] },
      ],
    ]),
  );

  const judgment = await new SecurityEvaluationDependencyJudgment(osv).judge(inputFor([reachable, unreachable]));

  // The skipped bucket names what was not looked at, and why.
  assert.equal(judgment.skipped?.total, 1);
  assert.deepEqual(judgment.skipped?.items, [unreachable.id]);
  assert.match(judgment.skipped?.note ?? "", /HTTP 503/);

  // Only the reachable package counts as evaluated.
  assert.deepEqual(judgment.evaluatedRefs, [reachable.id]);
  assert.equal(judgment.metadata?.packagesSkipped, 1);
  assert.match(judgment.summary ?? "", /1 skipped/);

  // The reachable package's problem is still reported normally.
  assert.equal(judgment.findings.length, 1);
  assert.equal(judgment.findings[0].fingerprint, "npm:lodash:GHSA-aaaa-bbbb-cccc");
  assert.equal(judgment.findings[0].severity, "HIGH");
});

test("a run whose every OSV query failed is a failed run, not a clean one", async () => {
  const items = [evidenceItem("lodash", "4.17.20"), evidenceItem("left-pad", "1.3.0")];
  const osv = stubOsv({
    vulnerabilitiesByPackageKey: new Map(),
    failedPackageKeys: ["lodash@4.17.20", "left-pad@1.3.0"],
    failureNote: "transport error",
  });

  await assert.rejects(
    () => new SecurityEvaluationDependencyJudgment(osv).judge(inputFor(items)),
    /Every OSV batch query failed/,
  );
});

test("a judgment with no package evidence is rejected instead of reporting nothing", async () => {
  const osv = stubOsv({ vulnerabilitiesByPackageKey: new Map(), failedPackageKeys: [] });

  await assert.rejects(
    () => new SecurityEvaluationDependencyJudgment(osv).judge(inputFor([])),
    /no package evidence items/,
  );
});
