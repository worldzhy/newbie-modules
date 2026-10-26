import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK,
  type CloudConfigFactSet,
} from "./judgment/cloud-config/security-evaluation-cloud-config.rulebook";
import {
  SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
  SECURITY_EVALUATION_FAMILY_CLOUD_CUSTOM,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for the cloud config rulebook (ADR-027 D3, ADR-037):
 * every control fails on the configuration it considers non-compliant and
 * passes otherwise. The judges are pure, so the contract is testable without
 * AWS or a database.
 */

function emptyFacts(): CloudConfigFactSet {
  return {
    passwordPolicy: null,
    rootCredential: null,
    userCredentials: [],
    accessKeys: [],
    policies: [],
    buckets: [],
    rdsInstances: [],
    securityGroups: [],
    instanceNetworks: [],
  };
}

function judge(criterionKey: string, facts: CloudConfigFactSet) {
  const entry = SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.find((item) => item.criterionKey === criterionKey);
  assert.ok(entry, `rulebook entry ${criterionKey} exists`);
  return entry.judge(facts);
}

const CIS_KEYS = [
  "cis-1-4",
  "cis-1-5",
  "cis-1-8",
  "cis-1-13",
  "cis-1-15",
  "cis-2-1-1",
  "cis-2-1-2",
  "cis-2-3-1",
  "cis-4-1",
  "cis-4-2",
] as const;

const CUSTOM_KEYS = [
  "iam.access-key-no-usage",
  "iam.access-key-old",
  "iam.user-multiple-access-keys",
  "iam.policy-notaction",
  "iam.policy-star-on-star",
  "iam.policy-service-wildcard",
  "iam.policy-sensitive-action",
  "rds.master-password-not-managed",
  "s3.no-versioning",
  "ec2.public-ip-with-public-ingress",
] as const;

test("rulebook ships ten CIS controls and ten aws-custom rules, each tagged to its family", () => {
  const cis = SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.filter(
    (entry) => entry.evaluationKey === SECURITY_EVALUATION_FAMILY_CLOUD_CONFIGURATION,
  );
  const custom = SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.filter(
    (entry) => entry.evaluationKey === SECURITY_EVALUATION_FAMILY_CLOUD_CUSTOM,
  );
  assert.deepEqual(
    cis.map((entry) => entry.criterionKey),
    [...CIS_KEYS],
  );
  assert.deepEqual(
    custom.map((entry) => entry.criterionKey),
    [...CUSTOM_KEYS],
  );
  // CIS controls carry a controlId; custom rules do not.
  assert.ok(cis.every((entry) => typeof entry.controlId === "string"));
  assert.ok(custom.every((entry) => entry.controlId === undefined));
});

test("cis-1-4 fails only while the root account holds active access keys", () => {
  const facts = emptyFacts();
  facts.rootCredential = {
    evidenceId: "cloud:aws.iam.root-credential:root",
    factKey: "root",
    payload: { passwordEnabled: true, mfaActive: true, activeAccessKeyCount: 1 },
  };
  assert.equal(judge("cis-1-4", facts).length, 1);
  facts.rootCredential.payload.activeAccessKeyCount = 0;
  assert.equal(judge("cis-1-4", facts).length, 0);
});

test("cis-1-5 fails when the root console password is enabled without MFA", () => {
  const facts = emptyFacts();
  facts.rootCredential = {
    evidenceId: "cloud:aws.iam.root-credential:root",
    factKey: "root",
    payload: { passwordEnabled: true, mfaActive: false, activeAccessKeyCount: 0 },
  };
  assert.equal(judge("cis-1-5", facts).length, 1);
  facts.rootCredential.payload.mfaActive = true;
  assert.equal(judge("cis-1-5", facts).length, 0);
  // A root account without console password cannot fail the MFA control.
  facts.rootCredential.payload = { passwordEnabled: false, mfaActive: false, activeAccessKeyCount: 0 };
  assert.equal(judge("cis-1-5", facts).length, 0);
});

test("cis-1-8 fails per console user without MFA and passes programmatic-only users", () => {
  const facts = emptyFacts();
  facts.userCredentials = [
    {
      evidenceId: "cloud:aws.iam.user-credential:alice",
      factKey: "alice",
      payload: { userName: "alice", passwordEnabled: true, mfaActive: false, passwordNextRotation: null },
    },
    {
      evidenceId: "cloud:aws.iam.user-credential:ci-bot",
      factKey: "ci-bot",
      payload: { userName: "ci-bot", passwordEnabled: false, mfaActive: false, passwordNextRotation: null },
    },
  ];
  const drafts = judge("cis-1-8", facts);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "alice");
});

test("cis-1-13 fails on a missing policy and on a minimum length below 14", () => {
  const facts = emptyFacts();
  facts.passwordPolicy = {
    evidenceId: "cloud:aws.iam.account-password-policy:account-password-policy",
    factKey: "account-password-policy",
    payload: { exists: false, minimumPasswordLength: null, maxPasswordAgeDays: null, expirePasswords: false },
  };
  assert.equal(judge("cis-1-13", facts).length, 1);
  facts.passwordPolicy.payload = {
    exists: true,
    minimumPasswordLength: 8,
    maxPasswordAgeDays: 90,
    expirePasswords: true,
  };
  assert.equal(judge("cis-1-13", facts).length, 1);
  facts.passwordPolicy.payload.minimumPasswordLength = 14;
  assert.equal(judge("cis-1-13", facts).length, 0);
});

test("cis-1-15 fails when passwords never expire", () => {
  const facts = emptyFacts();
  facts.passwordPolicy = {
    evidenceId: "cloud:aws.iam.account-password-policy:account-password-policy",
    factKey: "account-password-policy",
    payload: { exists: true, minimumPasswordLength: 14, maxPasswordAgeDays: null, expirePasswords: false },
  };
  assert.equal(judge("cis-1-15", facts).length, 1);
  facts.passwordPolicy.payload = {
    exists: true,
    minimumPasswordLength: 14,
    maxPasswordAgeDays: 90,
    expirePasswords: true,
  };
  assert.equal(judge("cis-1-15", facts).length, 0);
});

test("cis-2-1-1 fails per bucket without default encryption", () => {
  const facts = emptyFacts();
  facts.buckets = [
    {
      evidenceId: "cloud:aws.s3.bucket-security:plain",
      factKey: "plain",
      payload: {
        bucketName: "plain",
        region: "us-east-1",
        publicAccessBlock: null,
        policyIsPublic: false,
        aclPublic: false,
        encryptionEnabled: false,
        versioningEnabled: true,
      },
    },
    {
      evidenceId: "cloud:aws.s3.bucket-security:sealed",
      factKey: "sealed",
      payload: {
        bucketName: "sealed",
        region: "us-east-1",
        publicAccessBlock: null,
        policyIsPublic: false,
        aclPublic: false,
        encryptionEnabled: true,
        versioningEnabled: true,
      },
    },
  ];
  const drafts = judge("cis-2-1-1", facts);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "plain");
});

test("cis-2-1-2 fails on a missing or partial PAB, a public policy, or a public ACL", () => {
  const bucket = (overrides: Record<string, unknown>) => ({
    evidenceId: `cloud:aws.s3.bucket-security:${overrides.bucketName as string}`,
    factKey: overrides.bucketName as string,
    payload: {
      bucketName: "b",
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
      versioningEnabled: true,
      ...overrides,
    },
  });

  const facts = emptyFacts();
  facts.buckets = [bucket({ bucketName: "ok" })];
  assert.equal(judge("cis-2-1-2", facts).length, 0);

  facts.buckets = [bucket({ bucketName: "no-pab", publicAccessBlock: null })];
  assert.equal(judge("cis-2-1-2", facts).length, 1);

  facts.buckets = [
    bucket({
      bucketName: "partial",
      publicAccessBlock: {
        configured: true,
        blockPublicAcls: false,
        ignorePublicAcls: true,
        blockPublicPolicy: true,
        restrictPublicBuckets: true,
      },
    }),
  ];
  assert.equal(judge("cis-2-1-2", facts).length, 1);

  facts.buckets = [bucket({ bucketName: "policy", policyIsPublic: true })];
  assert.equal(judge("cis-2-1-2", facts).length, 1);

  facts.buckets = [bucket({ bucketName: "acl", aclPublic: true })];
  assert.equal(judge("cis-2-1-2", facts).length, 1);
});

test("cis-2-3-1 fails per publicly accessible or unencrypted instance", () => {
  const facts = emptyFacts();
  facts.rdsInstances = [
    {
      evidenceId: "cloud:aws.rds.instance-security:db1",
      factKey: "db1",
      payload: {
        identifier: "db1",
        region: "us-east-1",
        publiclyAccessible: true,
        storageEncrypted: true,
        masterUserSecretManaged: true,
      },
    },
    {
      evidenceId: "cloud:aws.rds.instance-security:db2",
      factKey: "db2",
      payload: {
        identifier: "db2",
        region: "us-east-1",
        publiclyAccessible: false,
        storageEncrypted: true,
        masterUserSecretManaged: true,
      },
    },
  ];
  const drafts = judge("cis-2-3-1", facts);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "db1");
});

test("cis-4-1 fails on all-traffic or management-port public ingress only", () => {
  const group = (
    groupId: string,
    publicIngress: { protocol: string; fromPort: number | null; toPort: number | null; cidr: string }[],
  ) => ({
    evidenceId: `cloud:aws.ec2.security-group-ingress:${groupId}`,
    factKey: groupId,
    payload: { groupId, region: "us-east-1", publicIngress },
  });

  const facts = emptyFacts();
  facts.securityGroups = [group("sg-web", [{ protocol: "tcp", fromPort: 443, toPort: 443, cidr: "0.0.0.0/0" }])];
  // Public HTTPS is a 4.2 concern, not management exposure.
  assert.equal(judge("cis-4-1", facts).length, 0);

  facts.securityGroups = [group("sg-ssh", [{ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0" }])];
  assert.equal(judge("cis-4-1", facts).length, 1);

  facts.securityGroups = [group("sg-all", [{ protocol: "-1", fromPort: null, toPort: null, cidr: "::/0" }])];
  assert.equal(judge("cis-4-1", facts).length, 1);

  // A wide range that happens to cover a management port counts too.
  facts.securityGroups = [group("sg-range", [{ protocol: "tcp", fromPort: 1, toPort: 1024, cidr: "0.0.0.0/0" }])];
  assert.equal(judge("cis-4-1", facts).length, 1);
});

test("cis-4-2 fails on any public ingress, including plain HTTPS", () => {
  const facts = emptyFacts();
  facts.securityGroups = [
    {
      evidenceId: "cloud:aws.ec2.security-group-ingress:sg-web",
      factKey: "sg-web",
      payload: {
        groupId: "sg-web",
        region: "us-east-1",
        publicIngress: [{ protocol: "tcp", fromPort: 443, toPort: 443, cidr: "0.0.0.0/0" }],
      },
    },
  ];
  assert.equal(judge("cis-4-2", facts).length, 1);
  facts.securityGroups[0].payload.publicIngress = [];
  assert.equal(judge("cis-4-2", facts).length, 0);
});
