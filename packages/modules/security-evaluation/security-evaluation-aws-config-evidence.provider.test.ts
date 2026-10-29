import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationRuleSetVersionRef, EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationAwsConfigEvidenceProvider } from "./evidence/security-evaluation-aws-config-evidence.provider";
import type { AwsConfigAccess } from "./ports/aws-config-access.port";
import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";

/**
 * Behavior-level tests for the aws-account evidence provider (ADR-027 D6):
 * collection failures land in the skipped bucket keyed by the affected
 * criteria, a fully uncollectable subject fails the run, and partial failure
 * never masquerades as a clean pass.
 */

const SUBJECT: EvaluationSubjectRef = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "aws-account",
  scopeType: "project",
  scopeId: "22222222-2222-4222-8222-222222222222",
  subjectKey: "binding-1",
  displayName: "123456789012",
};

const VERSION: EvaluationRuleSetVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "aws-account",
  evaluationKey: "aws-cis-1.5",
  version: "v1",
};

function stubAssets(): SecurityEvaluationAssetService {
  return {
    ensureAsset: async () => ({ id: "asset-1" }),
    upsertAwsConfigKnowledgeItems: async () => undefined,
    touchObserved: async () => undefined,
  } as unknown as SecurityEvaluationAssetService;
}

function stubAccess(collection: Awaited<ReturnType<AwsConfigAccess["collect"]>>): AwsConfigAccess {
  return { collect: async () => collection };
}

const PASSWORD_POLICY_FACT = {
  type: "aws.iam.account-password-policy",
  key: "account-password-policy",
  value: { exists: true, minimumPasswordLength: 14, maxPasswordAgeDays: 90, expirePasswords: true },
};

test("items become manifest items and asset items; a clean collection skips nothing", async () => {
  const provider = new SecurityEvaluationAwsConfigEvidenceProvider(
    stubAssets(),
    stubAccess({ items: [PASSWORD_POLICY_FACT], failures: [] }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.items.length, 1);
  assert.equal(collection.items[0].id, "cloud:aws.iam.account-password-policy:account-password-policy");
  assert.equal(collection.items[0].source, "aws-account");
  assert.deepEqual(collection.declaredUnlinked, { total: 0 });
  assert.equal(collection.skipped.total, 0);
});

test("an account-level failure skips exactly the criteria that needed the item type", async () => {
  const provider = new SecurityEvaluationAwsConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      items: [PASSWORD_POLICY_FACT],
      failures: [{ type: "aws.ec2.security-group-ingress", reason: "AccessDenied: ec2:DescribeSecurityGroups" }],
    }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.items.length, 1);
  assert.equal(collection.skipped.total, 2);
  assert.deepEqual([...(collection.skipped.items ?? [])].sort(), ["cis-4-1", "cis-4-2"]);
  assert.match(collection.skipped.note ?? "", /AccessDenied/);
});

test("a resource-level failure skips one resource of the affected criteria", async () => {
  const provider = new SecurityEvaluationAwsConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      items: [PASSWORD_POLICY_FACT],
      failures: [{ type: "aws.s3.bucket-security", key: "broken-bucket", reason: "AccessDenied" }],
    }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.skipped.total, 2);
  assert.deepEqual([...(collection.skipped.items ?? [])].sort(), [
    "cis-2-1-1:broken-bucket",
    "cis-2-1-2:broken-bucket",
  ]);
});

test("a subject whose items all failed to collect is a failed run, not a clean one", async () => {
  const provider = new SecurityEvaluationAwsConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      items: [],
      failures: [{ type: "aws.iam.root-credential", reason: "AccessDenied" }],
    }),
  );
  await assert.rejects(provider.collect(SUBJECT, VERSION), /No cloud configuration knowledge could be collected/);
});

test("an unbound AwsConfigAccess is a wiring error", async () => {
  const provider = new SecurityEvaluationAwsConfigEvidenceProvider(stubAssets());
  await assert.rejects(provider.collect(SUBJECT, VERSION), /No AwsConfigAccess is bound/);
});
