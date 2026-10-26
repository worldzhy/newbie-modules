import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationCriterionRef, EvaluationEvidenceItem } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import { SecurityEvaluationCloudConfigJudgment } from "./judgment/cloud-config/security-evaluation-cloud-config.judgment";
import { SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK } from "./judgment/cloud-config/security-evaluation-cloud-config.rulebook";

/**
 * Behavior-level tests for the CLOUD_CONFIG judgment assembly (ADR-027 D6):
 * finding identity is version-free (`aws:<criterionKey>:<resourceKey>`),
 * severity comes from the criterion metadata, and every collected fact counts
 * as evaluated.
 */

function evidenceItem(factType: string, factKey: string, value: Record<string, unknown>): EvaluationEvidenceItem {
  return {
    id: `cloud:${factType}:${factKey}`,
    layer: "fact",
    source: "cloud-account",
    summary: `${factType} ${factKey}`,
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { factType, ...value },
  };
}

const CRITERIA: EvaluationCriterionRef[] = SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.map((entry) => ({
  criterionKey: entry.criterionKey,
  kind: "ASSERTION",
  name: entry.name,
  metadata: { controlId: entry.controlId, severity: entry.severity },
}));

function inputFor(items: EvaluationEvidenceItem[], criteria = CRITERIA): JudgmentInput {
  return {
    subject: {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "cloud-account",
      scopeType: "project",
      scopeId: "22222222-2222-4222-8222-222222222222",
      subjectKey: "binding-1",
      displayName: "123456789012",
    },
    criteriaVersion: {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "cloud-account",
      evaluationKey: "cis-aws-1.5",
      version: "v1",
    },
    criteria,
    evidence: items,
    runConfig: null,
  };
}

const ROOT_WITH_KEYS = {
  passwordEnabled: true,
  mfaActive: true,
  activeAccessKeyCount: 1,
};

test("a failing control produces a version-free fingerprint keyed by the resource", async () => {
  const judgment = await new SecurityEvaluationCloudConfigJudgment().judge(
    inputFor([evidenceItem("aws.iam.root-credential", "root", ROOT_WITH_KEYS)]),
  );
  assert.equal(judgment.findings.length, 1);
  const finding = judgment.findings[0];
  assert.equal(finding.criterionKey, "cis-1-4");
  assert.equal(finding.fingerprint, "aws:cis-1-4:root");
  assert.equal(finding.severity, "HIGH");
  assert.deepEqual(finding.evidenceRefs, ["cloud:aws.iam.root-credential:root"]);
  assert.equal(finding.metadata?.controlId, "1.4");
  assert.equal(finding.metadata?.urgency, "P2");
});

test("severity is read from the criterion metadata, not hard-coded in the judgment", async () => {
  const criteria = CRITERIA.map((criterion) =>
    criterion.criterionKey === "cis-1-4"
      ? { ...criterion, metadata: { ...criterion.metadata, severity: "LOW" } }
      : criterion,
  );
  const judgment = await new SecurityEvaluationCloudConfigJudgment().judge(
    inputFor([evidenceItem("aws.iam.root-credential", "root", ROOT_WITH_KEYS)], criteria),
  );
  assert.equal(judgment.findings[0]?.severity, "LOW");
  // Urgency follows the overridden severity: LOW + internal exposure = P4.
  assert.equal(judgment.findings[0]?.metadata?.urgency, "P4");
});

test("passing controls produce no findings and every collected fact is evaluated", async () => {
  const items = [
    evidenceItem("aws.iam.root-credential", "root", {
      passwordEnabled: true,
      mfaActive: true,
      activeAccessKeyCount: 0,
    }),
    evidenceItem("aws.iam.account-password-policy", "account-password-policy", {
      exists: true,
      minimumPasswordLength: 14,
      maxPasswordAgeDays: 90,
      expirePasswords: true,
    }),
    evidenceItem("aws.ec2.security-group-ingress", "sg-1", {
      groupId: "sg-1",
      region: "us-east-1",
      publicIngress: [],
    }),
  ];
  const judgment = await new SecurityEvaluationCloudConfigJudgment().judge(inputFor(items));
  assert.equal(judgment.findings.length, 0);
  assert.deepEqual([...judgment.evaluatedRefs].sort(), items.map((item) => item.id).sort());
});

test("one failing resource among many yields one finding and full evaluation", async () => {
  const items = [
    evidenceItem("aws.s3.bucket-security", "plain", {
      bucketName: "plain",
      region: "us-east-1",
      publicAccessBlock: null,
      policyIsPublic: false,
      aclPublic: false,
      encryptionEnabled: false,
    }),
    evidenceItem("aws.s3.bucket-security", "sealed", {
      bucketName: "sealed",
      region: "us-east-1",
      publicAccessBlock: {
        configured: true,
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: true,
      },
      policyIsPublic: false,
      aclPublic: false,
      encryptionEnabled: true,
    }),
  ];
  const judgment = await new SecurityEvaluationCloudConfigJudgment().judge(inputFor(items));
  const fingerprints = judgment.findings.map((finding) => finding.fingerprint).sort();
  assert.deepEqual(fingerprints, ["aws:cis-2-1-1:plain", "aws:cis-2-1-2:plain:public-access-block"]);
  assert.equal(judgment.evaluatedRefs.length, 2);
});
