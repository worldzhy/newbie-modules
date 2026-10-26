import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  EvaluationCriteriaVersionRef,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import { SecurityEvaluationCloudConfigEvidenceProvider } from "./evidence/security-evaluation-cloud-config-evidence.provider";
import type { CloudConfigurationAccess } from "./ports/cloud-configuration-access.port";
import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";

/**
 * Behavior-level tests for the cloud-account evidence provider (ADR-027 D6):
 * collection failures land in the skipped bucket keyed by the affected
 * criteria, a fully uncollectable subject fails the run, and partial failure
 * never masquerades as a clean pass.
 */

const SUBJECT: EvaluationSubjectRef = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "cloud-account",
  scopeType: "project",
  scopeId: "22222222-2222-4222-8222-222222222222",
  subjectKey: "binding-1",
  displayName: "123456789012",
};

const VERSION: EvaluationCriteriaVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "cloud-account",
  family: "cis-aws-1.5",
  version: "v1",
};

function stubAssets(): SecurityEvaluationAssetService {
  return {
    ensureAsset: async () => ({ id: "asset-1" }),
    upsertFacts: async () => undefined,
    touchObserved: async () => undefined,
  } as unknown as SecurityEvaluationAssetService;
}

function stubAccess(
  collection: Awaited<ReturnType<CloudConfigurationAccess["collectFacts"]>>,
): CloudConfigurationAccess {
  return { collectFacts: async () => collection };
}

const PASSWORD_POLICY_FACT = {
  factType: "aws.iam.account-password-policy",
  factKey: "account-password-policy",
  value: { exists: true, minimumPasswordLength: 14, maxPasswordAgeDays: 90, expirePasswords: true },
};

test("facts become manifest items and asset facts; a clean collection skips nothing", async () => {
  const provider = new SecurityEvaluationCloudConfigEvidenceProvider(
    stubAssets(),
    stubAccess({ facts: [PASSWORD_POLICY_FACT], failures: [] }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.items.length, 1);
  assert.equal(collection.items[0].id, "cloud:aws.iam.account-password-policy:account-password-policy");
  assert.equal(collection.items[0].source, "cloud-account");
  assert.deepEqual(collection.declaredUnlinked, { total: 0 });
  assert.equal(collection.skipped.total, 0);
});

test("an account-level failure skips exactly the criteria that needed the fact type", async () => {
  const provider = new SecurityEvaluationCloudConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      facts: [PASSWORD_POLICY_FACT],
      failures: [{ factType: "aws.ec2.security-group-ingress", reason: "AccessDenied: ec2:DescribeSecurityGroups" }],
    }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.items.length, 1);
  assert.equal(collection.skipped.total, 2);
  assert.deepEqual([...(collection.skipped.items ?? [])].sort(), ["cis-4-1", "cis-4-2"]);
  assert.match(collection.skipped.note ?? "", /AccessDenied/);
});

test("a resource-level failure skips one resource of the affected criteria", async () => {
  const provider = new SecurityEvaluationCloudConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      facts: [PASSWORD_POLICY_FACT],
      failures: [{ factType: "aws.s3.bucket-security", factKey: "broken-bucket", reason: "AccessDenied" }],
    }),
  );
  const collection = await provider.collect(SUBJECT, VERSION);
  assert.equal(collection.skipped.total, 2);
  assert.deepEqual([...(collection.skipped.items ?? [])].sort(), [
    "cis-2-1-1:broken-bucket",
    "cis-2-1-2:broken-bucket",
  ]);
});

test("a subject whose facts all failed to collect is a failed run, not a clean one", async () => {
  const provider = new SecurityEvaluationCloudConfigEvidenceProvider(
    stubAssets(),
    stubAccess({
      facts: [],
      failures: [{ factType: "aws.iam.root-credential", reason: "AccessDenied" }],
    }),
  );
  await assert.rejects(provider.collect(SUBJECT, VERSION), /No cloud configuration facts could be collected/);
});

test("an unbound CloudConfigurationAccess is a wiring error", async () => {
  const provider = new SecurityEvaluationCloudConfigEvidenceProvider(stubAssets());
  await assert.rejects(provider.collect(SUBJECT, VERSION), /No CloudConfigurationAccess is bound/);
});
