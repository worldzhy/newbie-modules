import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvaluationCriterionRef, EvaluationEvidenceItem } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import { PenetrationTestingJudgmentService } from "./penetration-testing-judgment.service";
import {
  mapEngineFindingCriterion,
  normalizeSeverity,
  penetrationTestingFingerprint,
  upliftSeverity,
} from "./penetration-testing.mapping";

const subject = { id: "subject-1", subjectKey: "https://example.com", displayName: "Example" };
const service = new PenetrationTestingJudgmentService();

function input(standardKey: string, criteria: string[], evidence: EvaluationEvidenceItem[]): JudgmentInput {
  return {
    subject,
    ruleSetVersion: { id: "version-1", standardKey } as never,
    criteria: criteria.map((criterionKey) => ({ criterionKey }) as EvaluationCriterionRef),
    evidence,
    runConfig: null,
  };
}

function findingItem(finding: Record<string, unknown>): EvaluationEvidenceItem {
  return {
    id: "finding:0",
    layer: "finding",
    source: "nuclei",
    summary: "engine finding",
    observedAt: new Date("2026-11-21T00:00:00.000Z"),
    payload: { finding },
  };
}

const nucleiFinding = {
  engine: "nuclei",
  engineVersion: "3.3.0",
  ruleId: "CVE-2021-44228",
  title: "Log4Shell",
  severityRaw: "critical",
  location: "https://example.com/login",
};

describe("penetration-testing mapping", () => {
  it("maps engine findings to named criteria and falls back to unclassified", () => {
    assert.equal(
      mapEngineFindingCriterion(nucleiFinding, new Set(["vulnerable-component", "unclassified"])),
      "vulnerable-component",
    );
    assert.equal(
      mapEngineFindingCriterion(
        { ...nucleiFinding, ruleId: "xss-reflected", title: "Reflected XSS" },
        new Set(["injection", "unclassified"]),
      ),
      "unclassified",
    );
  });

  it("normalizes engine severities and CVSS scores", () => {
    assert.equal(normalizeSeverity("High"), "HIGH");
    assert.equal(normalizeSeverity("4"), "CRITICAL");
    assert.equal(normalizeSeverity("unknown", 7.5), "HIGH");
    assert.equal(normalizeSeverity("unknown"), "INFO");
    assert.equal(upliftSeverity("MEDIUM"), "HIGH");
    assert.equal(upliftSeverity("CRITICAL"), "CRITICAL");
  });

  it("builds a stable fingerprint from criterion, rule and location", () => {
    const first = penetrationTestingFingerprint({
      criterionKey: "injection",
      engine: "nuclei",
      ruleId: "CVE-1",
      location: "https://example.com/a",
    });
    const second = penetrationTestingFingerprint({
      criterionKey: "injection",
      engine: "nuclei",
      ruleId: "CVE-1",
      location: "https://example.com/a",
    });
    const other = penetrationTestingFingerprint({
      criterionKey: "injection",
      engine: "nuclei",
      ruleId: "CVE-1",
      location: "https://example.com/b",
    });
    assert.equal(first, second);
    assert.notEqual(first, other);
  });
});

describe("PenetrationTestingJudgmentService", () => {
  it("emits one finding per engine finding with evidence refs", async () => {
    const judgment = await service.judge(
      input("vulnerability-scan", ["vulnerable-component", "unclassified"], [findingItem(nucleiFinding)]),
    );
    assert.equal(judgment.verdicts.length, 0);
    assert.equal(judgment.findings.length, 1);
    assert.equal(judgment.findings[0].criterionKey, "vulnerable-component");
    assert.equal(judgment.findings[0].severity, "CRITICAL");
    assert.deepEqual(judgment.findings[0].evidenceRefs, ["finding:0"]);
    assert.deepEqual(judgment.evaluatedRefs, ["finding:0"]);
  });

  it("uplifts a confirmed exploit by one severity level (E2)", async () => {
    const judgment = await service.judge(
      input(
        "exploit-verification",
        ["confirmed-exploit"],
        [
          findingItem({
            ...nucleiFinding,
            ruleId: "sqlmap-confirmed",
            title: "SQL injection confirmed",
            severityRaw: "medium",
          }),
        ],
      ),
    );
    assert.equal(judgment.findings.length, 1);
    assert.equal(judgment.findings[0].criterionKey, "confirmed-exploit");
    assert.equal(judgment.findings[0].severity, "HIGH");
  });

  it("produces destructive-impact only when the object changed and cleanup succeeded (E3)", async () => {
    const evidence: EvaluationEvidenceItem[] = [
      {
        id: "action:before",
        layer: "action",
        source: "penetration-testing",
        summary: "before",
        observedAt: new Date(),
        payload: { playbookId: "sqli-write-proof", state: "no marker" },
      },
      {
        id: "action:after",
        layer: "action",
        source: "penetration-testing",
        summary: "after",
        observedAt: new Date(),
        payload: { playbookId: "sqli-write-proof", state: "marker present" },
      },
      {
        id: "action:cleanup",
        layer: "action",
        source: "penetration-testing",
        summary: "cleanup",
        observedAt: new Date(),
        payload: { playbookId: "sqli-write-proof", testObjectId: "object-1", cleanup: { succeeded: true } },
      },
    ];
    const judgment = await service.judge(input("destructive-testing", ["destructive-impact"], evidence));
    assert.equal(judgment.findings.length, 1);
    assert.equal(judgment.findings[0].criterionKey, "destructive-impact");
    assert.equal(judgment.findings[0].severity, "INFO");
    assert.deepEqual(judgment.findings[0].evidenceRefs, ["action:before", "action:after", "action:cleanup"]);

    const unchanged = await service.judge(
      input(
        "destructive-testing",
        ["destructive-impact"],
        [
          { ...evidence[0], payload: { playbookId: "sqli-write-proof", state: "same" } },
          { ...evidence[1], payload: { playbookId: "sqli-write-proof", state: "same" } },
          evidence[2],
        ],
      ),
    );
    assert.equal(unchanged.findings.length, 0);
  });
});
