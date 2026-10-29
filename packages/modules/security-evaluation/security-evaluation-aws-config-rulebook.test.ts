import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK,
  type AwsConfigKnowledgeSet,
} from "./judgment/aws-config/security-evaluation-aws-config.rulebook";
import {
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for the cloud config rulebook (ADR-027 D3, ADR-037):
 * every control fails on the configuration it considers non-compliant and
 * passes otherwise. The judges are pure, so the contract is testable without
 * AWS or a database.
 */

function emptyItems(): AwsConfigKnowledgeSet {
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

function judge(criterionKey: string, items: AwsConfigKnowledgeSet) {
  const entry = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.find((item) => item.criterionKey === criterionKey);
  assert.ok(entry, `rulebook entry ${criterionKey} exists`);
  return entry.judge(items);
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

test("rulebook ships ten CIS controls and ten aws-custom rules, each tagged to its evaluation key", () => {
  const cis = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
    (entry) => entry.evaluationKey === SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  );
  const custom = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter(
    (entry) => entry.evaluationKey === SECURITY_EVALUATION_KEY_AWS_CUSTOM,
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
  const items = emptyItems();
  items.rootCredential = {
    evidenceId: "cloud:aws.iam.root-credential:root",
    key: "root",
    payload: { passwordEnabled: true, mfaActive: true, activeAccessKeyCount: 1 },
  };
  assert.equal(judge("cis-1-4", items).length, 1);
  items.rootCredential.payload.activeAccessKeyCount = 0;
  assert.equal(judge("cis-1-4", items).length, 0);
});

test("cis-1-5 fails when the root console password is enabled without MFA", () => {
  const items = emptyItems();
  items.rootCredential = {
    evidenceId: "cloud:aws.iam.root-credential:root",
    key: "root",
    payload: { passwordEnabled: true, mfaActive: false, activeAccessKeyCount: 0 },
  };
  assert.equal(judge("cis-1-5", items).length, 1);
  items.rootCredential.payload.mfaActive = true;
  assert.equal(judge("cis-1-5", items).length, 0);
  // A root account without console password cannot fail the MFA control.
  items.rootCredential.payload = { passwordEnabled: false, mfaActive: false, activeAccessKeyCount: 0 };
  assert.equal(judge("cis-1-5", items).length, 0);
});

test("cis-1-8 fails per console user without MFA and passes programmatic-only users", () => {
  const items = emptyItems();
  items.userCredentials = [
    {
      evidenceId: "cloud:aws.iam.user-credential:alice",
      key: "alice",
      payload: { userName: "alice", passwordEnabled: true, mfaActive: false, passwordNextRotation: null },
    },
    {
      evidenceId: "cloud:aws.iam.user-credential:ci-bot",
      key: "ci-bot",
      payload: { userName: "ci-bot", passwordEnabled: false, mfaActive: false, passwordNextRotation: null },
    },
  ];
  const drafts = judge("cis-1-8", items);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "alice");
});

test("cis-1-13 fails on a missing policy and on a minimum length below 14", () => {
  const items = emptyItems();
  items.passwordPolicy = {
    evidenceId: "cloud:aws.iam.account-password-policy:account-password-policy",
    key: "account-password-policy",
    payload: { exists: false, minimumPasswordLength: null, maxPasswordAgeDays: null, expirePasswords: false },
  };
  assert.equal(judge("cis-1-13", items).length, 1);
  items.passwordPolicy.payload = {
    exists: true,
    minimumPasswordLength: 8,
    maxPasswordAgeDays: 90,
    expirePasswords: true,
  };
  assert.equal(judge("cis-1-13", items).length, 1);
  items.passwordPolicy.payload.minimumPasswordLength = 14;
  assert.equal(judge("cis-1-13", items).length, 0);
});

test("cis-1-15 fails when passwords never expire", () => {
  const items = emptyItems();
  items.passwordPolicy = {
    evidenceId: "cloud:aws.iam.account-password-policy:account-password-policy",
    key: "account-password-policy",
    payload: { exists: true, minimumPasswordLength: 14, maxPasswordAgeDays: null, expirePasswords: false },
  };
  assert.equal(judge("cis-1-15", items).length, 1);
  items.passwordPolicy.payload = {
    exists: true,
    minimumPasswordLength: 14,
    maxPasswordAgeDays: 90,
    expirePasswords: true,
  };
  assert.equal(judge("cis-1-15", items).length, 0);
});

test("cis-2-1-1 fails per bucket without default encryption", () => {
  const items = emptyItems();
  items.buckets = [
    {
      evidenceId: "cloud:aws.s3.bucket-security:plain",
      key: "plain",
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
      key: "sealed",
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
  const drafts = judge("cis-2-1-1", items);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "plain");
});

test("cis-2-1-2 fails on a missing or partial PAB, a public policy, or a public ACL", () => {
  const bucket = (overrides: Record<string, unknown>) => ({
    evidenceId: `cloud:aws.s3.bucket-security:${overrides.bucketName as string}`,
    key: overrides.bucketName as string,
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

  const items = emptyItems();
  items.buckets = [bucket({ bucketName: "ok" })];
  assert.equal(judge("cis-2-1-2", items).length, 0);

  items.buckets = [bucket({ bucketName: "no-pab", publicAccessBlock: null })];
  assert.equal(judge("cis-2-1-2", items).length, 1);

  items.buckets = [
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
  assert.equal(judge("cis-2-1-2", items).length, 1);

  items.buckets = [bucket({ bucketName: "policy", policyIsPublic: true })];
  assert.equal(judge("cis-2-1-2", items).length, 1);

  items.buckets = [bucket({ bucketName: "acl", aclPublic: true })];
  assert.equal(judge("cis-2-1-2", items).length, 1);
});

test("cis-2-3-1 fails per publicly accessible or unencrypted instance", () => {
  const items = emptyItems();
  items.rdsInstances = [
    {
      evidenceId: "cloud:aws.rds.instance-security:db1",
      key: "db1",
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
      key: "db2",
      payload: {
        identifier: "db2",
        region: "us-east-1",
        publiclyAccessible: false,
        storageEncrypted: true,
        masterUserSecretManaged: true,
      },
    },
  ];
  const drafts = judge("cis-2-3-1", items);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].resourceKey, "db1");
});

test("cis-4-1 fails on all-traffic or management-port public ingress only", () => {
  const group = (
    groupId: string,
    publicIngress: { protocol: string; fromPort: number | null; toPort: number | null; cidr: string }[],
  ) => ({
    evidenceId: `cloud:aws.ec2.security-group-ingress:${groupId}`,
    key: groupId,
    payload: { groupId, region: "us-east-1", publicIngress },
  });

  const items = emptyItems();
  items.securityGroups = [group("sg-web", [{ protocol: "tcp", fromPort: 443, toPort: 443, cidr: "0.0.0.0/0" }])];
  // Public HTTPS is a 4.2 concern, not management exposure.
  assert.equal(judge("cis-4-1", items).length, 0);

  items.securityGroups = [group("sg-ssh", [{ protocol: "tcp", fromPort: 22, toPort: 22, cidr: "0.0.0.0/0" }])];
  assert.equal(judge("cis-4-1", items).length, 1);

  items.securityGroups = [group("sg-all", [{ protocol: "-1", fromPort: null, toPort: null, cidr: "::/0" }])];
  assert.equal(judge("cis-4-1", items).length, 1);

  // A wide range that happens to cover a management port counts too.
  items.securityGroups = [group("sg-range", [{ protocol: "tcp", fromPort: 1, toPort: 1024, cidr: "0.0.0.0/0" }])];
  assert.equal(judge("cis-4-1", items).length, 1);
});

test("cis-4-2 fails on any public ingress, including plain HTTPS", () => {
  const items = emptyItems();
  items.securityGroups = [
    {
      evidenceId: "cloud:aws.ec2.security-group-ingress:sg-web",
      key: "sg-web",
      payload: {
        groupId: "sg-web",
        region: "us-east-1",
        publicIngress: [{ protocol: "tcp", fromPort: 443, toPort: 443, cidr: "0.0.0.0/0" }],
      },
    },
  ];
  assert.equal(judge("cis-4-2", items).length, 1);
  items.securityGroups[0].payload.publicIngress = [];
  assert.equal(judge("cis-4-2", items).length, 0);
});
