import type { SecurityEvaluationFindingSeverity } from "../security-evaluation-severity";
import {
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_INSTANCE_NETWORK,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ROOT_CREDENTIAL,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY,
  SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
  SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
  SECURITY_EVALUATION_KEY_AWS_CUSTOM,
} from "../../security-evaluation.constants";
import { awsConfigEvidenceId } from "./security-evaluation-aws-config.identity";

/**
 * The cloud configuration rulebook (ADR-027 D3, ADR-037). Two evaluationKeys
 * share one mechanism and one collected item inventory:
 *
 * - `aws-cis-1.5`: CIS AWS Foundations Benchmark v1.5 controls, each one
 *   ASSERTION criterion; PASS emits nothing, FAIL emits one finding draft per
 *   non-compliant resource.
 * - `aws-custom`: non-benchmark checks inherited from the predecessor
 *   aws-audit module that have no CIS control mapping; same judge mechanics,
 *   no controlId/benchmark metadata.
 *
 * Rule semantics mirror the predecessor aws-audit checks so the two reports
 * agree while they coexist (ADR-022 coexistence boundary).
 */

/** Typed item payloads, reconstructed from evidence item payloads. */
export interface PasswordPolicyKnowledgePayload {
  exists: boolean;
  minimumPasswordLength: number | null;
  maxPasswordAgeDays: number | null;
  expirePasswords: boolean;
}

export interface RootCredentialKnowledgePayload {
  passwordEnabled: boolean;
  mfaActive: boolean;
  activeAccessKeyCount: number;
}

export interface UserCredentialKnowledgePayload {
  userName: string;
  passwordEnabled: boolean;
  mfaActive: boolean;
  /** Credential report `password_next_rotation` (ADR-037 D6). */
  passwordNextRotation: string | null;
}

export interface AccessKeyKnowledgePayload {
  userName: string;
  accessKeyId: string;
  status: "Active" | "Inactive";
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PolicyAttachment {
  principalKind: "user" | "group" | "role";
  principalName: string;
}

export interface PolicyDocumentKnowledgePayload {
  kind: "managed" | "inline";
  /** Managed = ARN; inline = `inline:<principalKind>:<principalName>:<policyName>`. */
  identity: string;
  /** Raw policy JSON document as collected from AWS. */
  document: string;
  attachments: PolicyAttachment[];
}

export interface BucketSecurityKnowledgePayload {
  bucketName: string;
  region: string;
  publicAccessBlock: {
    configured: boolean;
    blockPublicAcls: boolean;
    ignorePublicAcls: boolean;
    blockPublicPolicy: boolean;
    restrictPublicBuckets: boolean;
  } | null;
  policyIsPublic: boolean;
  aclPublic: boolean;
  encryptionEnabled: boolean;
  /** ADR-037 D6 payload extension. */
  versioningEnabled: boolean;
}

export interface RdsInstanceSecurityKnowledgePayload {
  identifier: string;
  region: string;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  /** ADR-037 D6 payload extension. */
  masterUserSecretManaged: boolean;
}

export interface SecurityGroupPublicIngressRule {
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  cidr: string;
}

export interface SecurityGroupIngressKnowledgePayload {
  groupId: string;
  region: string;
  /** Only internet-open rules (0.0.0.0/0 or ::/0); empty means none. */
  publicIngress: SecurityGroupPublicIngressRule[];
}

export interface Ec2InstanceNetworkKnowledgePayload {
  instanceId: string;
  region: string;
  publicIpAddress: string | null;
  securityGroupIds: string[];
}

/** A knowledge item as the judges see it: typed payload plus its manifest identity. */
export interface AwsConfigKnowledge<T> {
  evidenceId: string;
  key: string;
  payload: T;
}

export interface AwsConfigKnowledgeSet {
  passwordPolicy: AwsConfigKnowledge<PasswordPolicyKnowledgePayload> | null;
  rootCredential: AwsConfigKnowledge<RootCredentialKnowledgePayload> | null;
  userCredentials: AwsConfigKnowledge<UserCredentialKnowledgePayload>[];
  accessKeys: AwsConfigKnowledge<AccessKeyKnowledgePayload>[];
  policies: AwsConfigKnowledge<PolicyDocumentKnowledgePayload>[];
  buckets: AwsConfigKnowledge<BucketSecurityKnowledgePayload>[];
  rdsInstances: AwsConfigKnowledge<RdsInstanceSecurityKnowledgePayload>[];
  securityGroups: AwsConfigKnowledge<SecurityGroupIngressKnowledgePayload>[];
  instanceNetworks: AwsConfigKnowledge<Ec2InstanceNetworkKnowledgePayload>[];
}

export interface AwsConfigFindingDraft {
  resourceKey: string;
  type: string;
  region?: string;
  title: string;
  detail: string;
  evidenceRefs: string[];
  /** Per-draft severity override (ADR-037 D4); falls back to criterion severity. */
  severity?: SecurityEvaluationFindingSeverity;
  /** Policy-finding attachments context (ADR-037 D5). */
  attachments?: PolicyAttachment[];
}

export interface AwsConfigRulebookEntry {
  criterionKey: string;
  /** CIS control id; absent for aws-custom entries. */
  controlId?: string;
  name: string;
  severity: SecurityEvaluationFindingSeverity;
  remediation: string;
  requiredKnowledgeTypes: readonly string[];
  /** Which evaluationKey this entry belongs to (aws-cis-1.5 or aws-custom). */
  evaluationKey: string;
  judge(items: AwsConfigKnowledgeSet): AwsConfigFindingDraft[];
}

/** Ports whose internet-open ingress CIS treats as management exposure. */
export const SECURITY_EVALUATION_AWS_CONFIG_SENSITIVE_PORTS = [22, 3389, 3306, 5432, 6379, 27017, 9200] as const;

/** aws-custom access-key age threshold (ADR-037 D6). */
export const SECURITY_EVALUATION_AWS_CUSTOM_ACCESS_KEY_MAX_AGE_DAYS = 90;

/** IAM actions treated as sensitive for `iam.policy-sensitive-action`. */
const SENSITIVE_ACTIONS = ["iam:PassRole", "sts:AssumeRole", "kms:Decrypt", "secretsmanager:GetSecretValue"];

/** Services whose `service:*` wildcard is HIGH; everything else is MEDIUM. */
const HIGH_SEVERITY_WILDCARD_SERVICES = new Set(["iam", "sts", "kms", "organizations"]);

const PASSWORD_MIN_LENGTH = 14;

function rootCredentialEntry(
  partial: Omit<AwsConfigRulebookEntry, "requiredKnowledgeTypes" | "judge" | "evaluationKey">,
  fail: (item: RootCredentialKnowledgePayload) => string | null,
): AwsConfigRulebookEntry {
  return {
    ...partial,
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ROOT_CREDENTIAL],
    judge(items) {
      const item = items.rootCredential;
      if (!item) return [];
      const reason = fail(item.payload);
      if (!reason) return [];
      return [
        {
          resourceKey: "root",
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ROOT_CREDENTIAL,
          title: partial.name,
          detail: reason,
          evidenceRefs: [item.evidenceId],
        },
      ];
    },
  };
}

function passwordPolicyEntry(
  partial: Omit<AwsConfigRulebookEntry, "requiredKnowledgeTypes" | "judge" | "evaluationKey">,
  fail: (item: PasswordPolicyKnowledgePayload) => string | null,
): AwsConfigRulebookEntry {
  return {
    ...partial,
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY],
    judge(items) {
      const item = items.passwordPolicy;
      if (!item) return [];
      const reason = fail(item.payload);
      if (!reason) return [];
      return [
        {
          resourceKey: "account-password-policy",
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
          title: partial.name,
          detail: reason,
          evidenceRefs: [item.evidenceId],
        },
      ];
    },
  };
}

function securityGroupHasManagementExposure(rule: SecurityGroupPublicIngressRule): boolean {
  if (rule.protocol === "-1") return true;
  const fromPort = rule.fromPort ?? -1;
  const toPort = rule.toPort ?? -1;
  return SECURITY_EVALUATION_AWS_CONFIG_SENSITIVE_PORTS.some((port) => port >= fromPort && port <= toPort);
}

function describePublicIngress(rule: SecurityGroupPublicIngressRule): string {
  const ports = rule.protocol === "-1" ? "all ports" : `${rule.protocol} ${rule.fromPort ?? "?"}-${rule.toPort ?? "?"}`;
  return `${rule.cidr} -> ${ports}`;
}

function asArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

interface ParsedStatement {
  Effect?: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
}

function parsePolicyStatements(document: string): ParsedStatement[] {
  try {
    const parsed = JSON.parse(document) as { Statement?: ParsedStatement | ParsedStatement[] };
    const statement = parsed.Statement;
    if (!statement) return [];
    return Array.isArray(statement) ? statement : [statement];
  } catch {
    return [];
  }
}

function statementAllowsAllResources(statement: ParsedStatement): boolean {
  return asArray(statement.Resource).includes("*");
}

function policyServiceOf(action: string): string | null {
  // "iam:PassRole" -> "iam"; "s3:*" -> "s3"; "ec2:Describe*" -> "ec2"
  const colon = action.indexOf(":");
  return colon === -1 ? null : action.slice(0, colon);
}

function daysBetween(now: Date, iso: string): number | null {
  const created = new Date(iso).getTime();
  if (!Number.isFinite(created)) return null;
  return Math.floor((now.getTime() - created) / 86_400_000);
}

export const SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK: readonly AwsConfigRulebookEntry[] = [
  // ── CIS AWS Foundations Benchmark v1.5 ─────────────────────────────────
  rootCredentialEntry(
    {
      criterionKey: "cis-1-4",
      controlId: "1.4",
      name: "Root account has no active access keys",
      severity: "HIGH",
      remediation: "Remove root access keys and use IAM roles or IAM users instead.",
    },
    (item) =>
      item.activeAccessKeyCount > 0
        ? `The root account still has ${item.activeAccessKeyCount} active access key(s).`
        : null,
  ),
  rootCredentialEntry(
    {
      criterionKey: "cis-1-5",
      controlId: "1.5",
      name: "Root account has MFA enabled",
      severity: "HIGH",
      remediation: "Enable MFA on the root account immediately.",
    },
    (item) =>
      item.passwordEnabled && !item.mfaActive ? "Root console access is enabled but MFA is not active." : null,
  ),
  {
    criterionKey: "cis-1-8",
    controlId: "1.8",
    name: "IAM console users have MFA enabled",
    severity: "MEDIUM",
    remediation: "Require MFA for every console-capable IAM user.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL],
    judge(items) {
      return items.userCredentials
        .filter((item) => item.payload.passwordEnabled && !item.payload.mfaActive)
        .map((item) => ({
          resourceKey: item.payload.userName,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL,
          title: `IAM console user ${item.payload.userName} does not have MFA enabled`,
          detail: `User ${item.payload.userName} has console password access without MFA.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },
  passwordPolicyEntry(
    {
      criterionKey: "cis-1-13",
      controlId: "1.13",
      name: "IAM password policy requires at least 14 characters",
      severity: "MEDIUM",
      remediation: "Configure an account password policy with a minimum length of at least 14 characters.",
    },
    (item) =>
      !item.exists
        ? "No account password policy is configured."
        : (item.minimumPasswordLength ?? 0) < PASSWORD_MIN_LENGTH
          ? `The minimum password length is ${item.minimumPasswordLength ?? 0}, below ${PASSWORD_MIN_LENGTH}.`
          : null,
  ),
  {
    // Merges predecessor `iam.user-password-expired` (HIGH) and
    // `iam.user-password-rotation-unclear` (MEDIUM) into one CIS criterion;
    // per-draft severity keeps each condition's literal severity (ADR-037 D4).
    criterionKey: "cis-1-15",
    controlId: "1.15",
    name: "IAM password policy expires passwords and console passwords rotate",
    severity: "MEDIUM",
    remediation: "Set maxPasswordAge so console passwords expire; ensure every console user's password rotates.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [
      SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
      SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL,
    ],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      const policy = items.passwordPolicy;
      if (!policy?.payload.exists) {
        drafts.push({
          resourceKey: "account-password-policy",
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
          title: "IAM password policy does not expire passwords",
          detail: "No account password policy is configured.",
          evidenceRefs: policy ? [policy.evidenceId] : [],
        });
      } else if (!policy.payload.expirePasswords || !policy.payload.maxPasswordAgeDays) {
        drafts.push({
          resourceKey: "account-password-policy",
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
          title: "IAM password policy does not expire passwords",
          detail: "The account password policy does not enforce password expiration.",
          evidenceRefs: [policy.evidenceId],
        });
      }
      for (const item of items.userCredentials) {
        const user = item.payload;
        if (!user.passwordEnabled) continue;
        if (user.passwordNextRotation === null) {
          drafts.push({
            resourceKey: `${user.userName}:rotation-unclear`,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL,
            title: `IAM user ${user.userName} password rotation is unclear`,
            detail: `User ${user.userName} has a console password but no password_next_rotation recorded.`,
            evidenceRefs: [item.evidenceId],
            severity: "MEDIUM",
          });
        } else {
          const nextRotation = new Date(user.passwordNextRotation).getTime();
          if (Number.isFinite(nextRotation) && nextRotation < Date.now()) {
            drafts.push({
              resourceKey: `${user.userName}:password-expired`,
              type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL,
              title: `IAM user ${user.userName} password is expired`,
              detail: `User ${user.userName} password next rotation (${user.passwordNextRotation}) is in the past.`,
              evidenceRefs: [item.evidenceId],
              severity: "HIGH",
            });
          }
        }
      }
      return drafts;
    },
  },
  {
    criterionKey: "cis-2-1-1",
    controlId: "2.1.1",
    name: "S3 buckets have default encryption enabled",
    severity: "MEDIUM",
    remediation: "Enable SSE-S3 or SSE-KMS for default bucket encryption.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY],
    judge(items) {
      return items.buckets
        .filter((item) => !item.payload.encryptionEnabled)
        .map((item) => ({
          resourceKey: item.payload.bucketName,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
          region: item.payload.region,
          title: `S3 bucket ${item.payload.bucketName} does not have default encryption enabled`,
          detail: `Bucket ${item.payload.bucketName} does not report a default server-side encryption rule.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },
  {
    // Merges predecessor pab-missing (MEDIUM), pab-partial (HIGH),
    // policy-public (HIGH), acl-public (HIGH). Per-draft severity mirrors the
    // predecessor rule severities (ADR-037 D4).
    criterionKey: "cis-2-1-2",
    controlId: "2.1.2",
    name: "S3 buckets block public access",
    severity: "HIGH",
    remediation: "Enable every Public Access Block flag and remove public bucket policies or ACL grants.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.buckets) {
        const bucket = item.payload;
        const pab = bucket.publicAccessBlock;
        if (!pab?.configured) {
          drafts.push({
            resourceKey: `${bucket.bucketName}:public-access-block`,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
            region: bucket.region,
            title: `S3 bucket ${bucket.bucketName} has no Public Access Block configuration`,
            detail: `Bucket ${bucket.bucketName} has no Public Access Block configuration.`,
            evidenceRefs: [item.evidenceId],
            severity: "MEDIUM",
          });
        } else if (
          !pab.blockPublicAcls ||
          !pab.ignorePublicAcls ||
          !pab.blockPublicPolicy ||
          !pab.restrictPublicBuckets
        ) {
          drafts.push({
            resourceKey: `${bucket.bucketName}:public-access-block`,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
            region: bucket.region,
            title: `S3 bucket ${bucket.bucketName} Public Access Block is partially disabled`,
            detail: `Bucket ${bucket.bucketName} Public Access Block is partially disabled.`,
            evidenceRefs: [item.evidenceId],
            severity: "HIGH",
          });
        }
        if (bucket.policyIsPublic) {
          drafts.push({
            resourceKey: `${bucket.bucketName}:policy`,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
            region: bucket.region,
            title: `S3 bucket ${bucket.bucketName} policy is public`,
            detail: `Bucket ${bucket.bucketName} bucket policy is evaluated by AWS as public.`,
            evidenceRefs: [item.evidenceId],
            severity: "HIGH",
          });
        }
        if (bucket.aclPublic) {
          drafts.push({
            resourceKey: `${bucket.bucketName}:acl`,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
            region: bucket.region,
            title: `S3 bucket ${bucket.bucketName} ACL grants public access`,
            detail: `Bucket ${bucket.bucketName} bucket ACL grants public access.`,
            evidenceRefs: [item.evidenceId],
            severity: "HIGH",
          });
        }
      }
      return drafts;
    },
  },
  {
    criterionKey: "cis-2-3-1",
    controlId: "2.3.1",
    name: "RDS instances are private and encrypted",
    severity: "HIGH",
    remediation: "Move databases to private subnets and enable storage encryption.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.rdsInstances) {
        const instance = item.payload;
        const gaps: string[] = [];
        if (instance.publiclyAccessible) gaps.push("publicly accessible");
        if (!instance.storageEncrypted) gaps.push("storage encryption disabled");
        if (gaps.length === 0) continue;
        drafts.push({
          resourceKey: instance.identifier,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY,
          region: instance.region,
          title: `RDS instance ${instance.identifier} is ${gaps.join(" and ")}`,
          detail: `RDS instance ${instance.identifier} is ${gaps.join(" and ")}.`,
          evidenceRefs: [item.evidenceId],
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "cis-4-1",
    controlId: "4.1",
    name: "Security groups do not expose management ports to the internet",
    severity: "HIGH",
    remediation: "Restrict SSH/RDP/database ports to trusted internal CIDRs or VPN ingress.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.securityGroups) {
        const group = item.payload;
        const offending = group.publicIngress.filter(securityGroupHasManagementExposure);
        if (offending.length === 0) continue;
        drafts.push({
          resourceKey: group.groupId,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
          region: group.region,
          title: `Security group ${group.groupId} exposes management access to the internet`,
          detail: `Security group ${group.groupId} allows ${offending.map(describePublicIngress).join("; ")}.`,
          evidenceRefs: [item.evidenceId],
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "cis-4-2",
    controlId: "4.2",
    name: "Security groups have no public ingress",
    severity: "MEDIUM",
    remediation: "Review whether each public ingress rule is required.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CIS_1_5,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS],
    judge(items) {
      return items.securityGroups
        .filter((item) => item.payload.publicIngress.length > 0)
        .map((item) => ({
          resourceKey: item.payload.groupId,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
          region: item.payload.region,
          title: `Security group ${item.payload.groupId} has public ingress`,
          detail: `Security group ${item.payload.groupId} allows ${item.payload.publicIngress
            .map(describePublicIngress)
            .join("; ")}.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },

  // ── aws-custom (no CIS control mapping; predecessor aws-audit rules) ────
  {
    criterionKey: "iam.access-key-no-usage",
    name: "Active IAM access keys have been used",
    severity: "LOW",
    remediation: "Remove active access keys that have never been used.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY],
    judge(items) {
      return items.accessKeys
        .filter((item) => item.payload.status === "Active" && item.payload.lastUsedAt === null)
        .map((item) => ({
          resourceKey: item.payload.accessKeyId,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY,
          title: `Active access key ${item.payload.accessKeyId} has never been used`,
          detail: `User ${item.payload.userName} access key ${item.payload.accessKeyId} is active with no recorded usage.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },
  {
    criterionKey: "iam.access-key-old",
    name: "Active IAM access keys are younger than 90 days",
    severity: "MEDIUM",
    remediation: "Rotate access keys older than 90 days.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY],
    judge(items) {
      const now = new Date();
      return items.accessKeys
        .filter((item) => {
          if (item.payload.status !== "Active") return false;
          const age = daysBetween(now, item.payload.createdAt);
          return age !== null && age > SECURITY_EVALUATION_AWS_CUSTOM_ACCESS_KEY_MAX_AGE_DAYS;
        })
        .map((item) => {
          const age = daysBetween(now, item.payload.createdAt) ?? 0;
          return {
            resourceKey: item.payload.accessKeyId,
            type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY,
            title: `Active access key ${item.payload.accessKeyId} is older than 90 days`,
            detail: `User ${item.payload.userName} access key ${item.payload.accessKeyId} is ${age} days old.`,
            evidenceRefs: [item.evidenceId],
          };
        });
    },
  },
  {
    criterionKey: "iam.user-multiple-access-keys",
    name: "IAM users have at most one active access key",
    severity: "MEDIUM",
    remediation: "Reduce each user to at most one active access key.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY],
    judge(items) {
      const activeByUser = new Map<string, AwsConfigKnowledge<AccessKeyKnowledgePayload>[]>();
      for (const item of items.accessKeys) {
        if (item.payload.status !== "Active") continue;
        const list = activeByUser.get(item.payload.userName) ?? [];
        list.push(item);
        activeByUser.set(item.payload.userName, list);
      }
      const drafts: AwsConfigFindingDraft[] = [];
      for (const [userName, keys] of activeByUser) {
        if (keys.length <= 1) continue;
        drafts.push({
          resourceKey: userName,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY,
          title: `IAM user ${userName} has ${keys.length} active access keys`,
          detail: `User ${userName} has ${keys.length} active access keys (${keys
            .map((k) => k.payload.accessKeyId)
            .join(", ")}).`,
          evidenceRefs: keys.map((k) => k.evidenceId),
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "iam.policy-notaction",
    name: "IAM policies do not use Allow with NotAction",
    severity: "MEDIUM",
    remediation: "Rewrite Allow+NotAction statements as explicit Allow lists.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.policies) {
        const policy = item.payload;
        const hasAllowNotAction = parsePolicyStatements(policy.document).some(
          (stmt) => stmt.Effect === "Allow" && asArray(stmt.NotAction).length > 0,
        );
        if (!hasAllowNotAction) continue;
        drafts.push({
          resourceKey: policy.identity,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT,
          title: `Policy ${policy.identity} uses Allow with NotAction`,
          detail: `Policy ${policy.identity} contains an Allow statement with NotAction, which grants all actions except the listed ones.`,
          evidenceRefs: [item.evidenceId],
          attachments: policy.attachments,
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "iam.policy-star-on-star",
    name: "IAM policies do not grant Action * on Resource *",
    severity: "HIGH",
    remediation: "Scope broad Allow statements to specific actions and resources.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.policies) {
        const policy = item.payload;
        const offending = parsePolicyStatements(policy.document).filter(
          (stmt) => stmt.Effect === "Allow" && asArray(stmt.Action).includes("*") && statementAllowsAllResources(stmt),
        );
        if (offending.length === 0) continue;
        drafts.push({
          resourceKey: policy.identity,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT,
          title: `Policy ${policy.identity} grants Action * on Resource *`,
          detail: `Policy ${policy.identity} contains ${offending.length} Allow statement(s) granting all actions on all resources.`,
          evidenceRefs: [item.evidenceId],
          attachments: policy.attachments,
        });
      }
      return drafts;
    },
  },
  {
    // Service wildcard `service:*` on Resource *. Severity is per-service:
    // iam/sts/kms/organizations = HIGH, everything else = MEDIUM (ADR-037 D6).
    criterionKey: "iam.policy-service-wildcard",
    name: "IAM policies do not grant service-wide actions on all resources",
    severity: "MEDIUM",
    remediation: "Replace service-wide wildcards with the specific actions required.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.policies) {
        const policy = item.payload;
        const services = new Set<string>();
        for (const stmt of parsePolicyStatements(policy.document)) {
          if (stmt.Effect !== "Allow" || !statementAllowsAllResources(stmt)) continue;
          for (const action of asArray(stmt.Action)) {
            if (!action.endsWith(":*")) continue;
            const service = policyServiceOf(action);
            if (service) services.add(service);
          }
        }
        if (services.size === 0) continue;
        const serviceList = [...services].sort();
        const severity: SecurityEvaluationFindingSeverity = serviceList.some((s) =>
          HIGH_SEVERITY_WILDCARD_SERVICES.has(s),
        )
          ? "HIGH"
          : "MEDIUM";
        drafts.push({
          resourceKey: policy.identity,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT,
          title: `Policy ${policy.identity} grants service-wide actions on all resources`,
          detail: `Policy ${policy.identity} grants wildcard actions for services: ${serviceList.join(", ")}.`,
          evidenceRefs: [item.evidenceId],
          attachments: policy.attachments,
          severity,
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "iam.policy-sensitive-action",
    name: "IAM policies do not grant sensitive actions on all resources",
    severity: "HIGH",
    remediation: "Restrict PassRole/AssumeRole/Decrypt/GetSecretValue to specific resources.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT],
    judge(items) {
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.policies) {
        const policy = item.payload;
        const matched = new Set<string>();
        for (const stmt of parsePolicyStatements(policy.document)) {
          if (stmt.Effect !== "Allow" || !statementAllowsAllResources(stmt)) continue;
          for (const action of asArray(stmt.Action)) {
            if (SENSITIVE_ACTIONS.includes(action)) matched.add(action);
          }
        }
        if (matched.size === 0) continue;
        drafts.push({
          resourceKey: policy.identity,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT,
          title: `Policy ${policy.identity} grants sensitive actions on all resources`,
          detail: `Policy ${policy.identity} grants ${[...matched].sort().join(", ")} on Resource *.`,
          evidenceRefs: [item.evidenceId],
          attachments: policy.attachments,
        });
      }
      return drafts;
    },
  },
  {
    criterionKey: "rds.master-password-not-managed",
    name: "RDS instances manage the master user password in Secrets Manager",
    severity: "MEDIUM",
    remediation: "Enable RDS managed master user credentials in AWS Secrets Manager.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY],
    judge(items) {
      return items.rdsInstances
        .filter((item) => !item.payload.masterUserSecretManaged)
        .map((item) => ({
          resourceKey: item.payload.identifier,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY,
          region: item.payload.region,
          title: `RDS instance ${item.payload.identifier} does not manage the master password in Secrets Manager`,
          detail: `RDS instance ${item.payload.identifier} master user password is not managed by AWS Secrets Manager.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },
  {
    criterionKey: "s3.no-versioning",
    name: "S3 buckets have versioning enabled",
    severity: "LOW",
    remediation: "Enable versioning on S3 buckets to protect against accidental deletion.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY],
    judge(items) {
      return items.buckets
        .filter((item) => !item.payload.versioningEnabled)
        .map((item) => ({
          resourceKey: item.payload.bucketName,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY,
          region: item.payload.region,
          title: `S3 bucket ${item.payload.bucketName} does not have versioning enabled`,
          detail: `Bucket ${item.payload.bucketName} does not have object versioning enabled.`,
          evidenceRefs: [item.evidenceId],
        }));
    },
  },
  {
    criterionKey: "ec2.public-ip-with-public-ingress",
    name: "EC2 instances with a public IP do not expose public ingress",
    severity: "HIGH",
    remediation: "Remove the public IP or restrict the instance's security groups to non-public ingress.",
    evaluationKey: SECURITY_EVALUATION_KEY_AWS_CUSTOM,
    requiredKnowledgeTypes: [
      SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_INSTANCE_NETWORK,
      SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
    ],
    judge(items) {
      const publicSgIds = new Set(
        items.securityGroups.filter((sg) => sg.payload.publicIngress.length > 0).map((sg) => sg.payload.groupId),
      );
      const drafts: AwsConfigFindingDraft[] = [];
      for (const item of items.instanceNetworks) {
        const instance = item.payload;
        if (!instance.publicIpAddress) continue;
        const exposingSg = instance.securityGroupIds.filter((id) => publicSgIds.has(id));
        if (exposingSg.length === 0) continue;
        drafts.push({
          resourceKey: instance.instanceId,
          type: SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_INSTANCE_NETWORK,
          region: instance.region,
          title: `EC2 instance ${instance.instanceId} has a public IP and public ingress`,
          detail: `Instance ${instance.instanceId} (${instance.publicIpAddress}) is reachable via security groups ${exposingSg.join(", ")}.`,
          evidenceRefs: [
            item.evidenceId,
            ...exposingSg
              .map((id) => items.securityGroups.find((sg) => sg.payload.groupId === id)?.evidenceId)
              .filter((id): id is string => Boolean(id)),
          ],
        });
      }
      return drafts;
    },
  },
];

export const SECURITY_EVALUATION_AWS_CIS_BENCHMARK = "CIS AWS Foundations Benchmark v1.5";

/**
 * All item types the cloud configuration rulebook consumes, across both
 * families. Used by the evidence provider to know what to request from the
 * shared collector.
 */
export const SECURITY_EVALUATION_AWS_CONFIG_REQUIRED_KNOWLEDGE_TYPES: readonly string[] = Array.from(
  new Set(SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.flatMap((entry) => [...entry.requiredKnowledgeTypes])),
);

/** Rebuild the typed item set from manifest items (payloads cross the port as JSON). */
export function rebuildAwsConfigKnowledge(
  items: readonly { id: string; payload?: Record<string, unknown> }[],
): AwsConfigKnowledgeSet {
  const set: AwsConfigKnowledgeSet = {
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
  for (const item of items) {
    const payload = item.payload ?? {};
    const key = awsConfigKeyFromEvidenceId(item.id);
    switch (payload.type) {
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY:
        set.passwordPolicy = { evidenceId: item.id, key, payload: toPasswordPolicy(payload) };
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ROOT_CREDENTIAL:
        set.rootCredential = { evidenceId: item.id, key, payload: toRootCredential(payload) };
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_USER_CREDENTIAL:
        set.userCredentials.push({ evidenceId: item.id, key, payload: toUserCredential(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_ACCESS_KEY:
        set.accessKeys.push({ evidenceId: item.id, key, payload: toAccessKey(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_IAM_POLICY_DOCUMENT:
        set.policies.push({ evidenceId: item.id, key, payload: toPolicyDocument(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_S3_BUCKET_SECURITY:
        set.buckets.push({ evidenceId: item.id, key, payload: toBucketSecurity(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_RDS_INSTANCE_SECURITY:
        set.rdsInstances.push({ evidenceId: item.id, key, payload: toRdsInstanceSecurity(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS:
        set.securityGroups.push({ evidenceId: item.id, key, payload: toSecurityGroupIngress(payload) });
        break;
      case SECURITY_EVALUATION_KNOWLEDGE_TYPE_AWS_EC2_INSTANCE_NETWORK:
        set.instanceNetworks.push({ evidenceId: item.id, key, payload: toEc2InstanceNetwork(payload) });
        break;
      default:
        break;
    }
  }
  return set;
}

function awsConfigKeyFromEvidenceId(evidenceId: string): string {
  const prefix = "cloud:";
  const withoutPrefix = evidenceId.startsWith(prefix) ? evidenceId.slice(prefix.length) : evidenceId;
  const separator = withoutPrefix.indexOf(":");
  return separator === -1 ? withoutPrefix : withoutPrefix.slice(separator + 1);
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function toPasswordPolicy(payload: Record<string, unknown>): PasswordPolicyKnowledgePayload {
  return {
    exists: asBoolean(payload.exists),
    minimumPasswordLength: asNullableNumber(payload.minimumPasswordLength),
    maxPasswordAgeDays: asNullableNumber(payload.maxPasswordAgeDays),
    expirePasswords: asBoolean(payload.expirePasswords),
  };
}

function toRootCredential(payload: Record<string, unknown>): RootCredentialKnowledgePayload {
  return {
    passwordEnabled: asBoolean(payload.passwordEnabled),
    mfaActive: asBoolean(payload.mfaActive),
    activeAccessKeyCount: asNullableNumber(payload.activeAccessKeyCount) ?? 0,
  };
}

function toUserCredential(payload: Record<string, unknown>): UserCredentialKnowledgePayload {
  return {
    userName: asString(payload.userName, "unknown-user"),
    passwordEnabled: asBoolean(payload.passwordEnabled),
    mfaActive: asBoolean(payload.mfaActive),
    passwordNextRotation: asNullableString(payload.passwordNextRotation),
  };
}

function toAccessKey(payload: Record<string, unknown>): AccessKeyKnowledgePayload {
  return {
    userName: asString(payload.userName, "unknown-user"),
    accessKeyId: asString(payload.accessKeyId, "unknown-key"),
    status: payload.status === "Inactive" ? "Inactive" : "Active",
    createdAt: asString(payload.createdAt, new Date(0).toISOString()),
    lastUsedAt: asNullableString(payload.lastUsedAt),
  };
}

function toPolicyDocument(payload: Record<string, unknown>): PolicyDocumentKnowledgePayload {
  const attachments = Array.isArray(payload.attachments)
    ? payload.attachments
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .map((a) => ({
          principalKind: (["user", "group", "role"].includes(String(a.principalKind))
            ? String(a.principalKind)
            : "user") as PolicyAttachment["principalKind"],
          principalName: asString(a.principalName, "unknown"),
        }))
    : [];
  return {
    kind: payload.kind === "inline" ? "inline" : "managed",
    identity: asString(payload.identity, "unknown-policy"),
    document: asString(payload.document, "{}"),
    attachments,
  };
}

function toBucketSecurity(payload: Record<string, unknown>): BucketSecurityKnowledgePayload {
  const block = payload.publicAccessBlock;
  const publicAccessBlock =
    block && typeof block === "object"
      ? {
          configured: asBoolean((block as Record<string, unknown>).configured),
          blockPublicAcls: asBoolean((block as Record<string, unknown>).blockPublicAcls),
          ignorePublicAcls: asBoolean((block as Record<string, unknown>).ignorePublicAcls),
          blockPublicPolicy: asBoolean((block as Record<string, unknown>).blockPublicPolicy),
          restrictPublicBuckets: asBoolean((block as Record<string, unknown>).restrictPublicBuckets),
        }
      : null;
  return {
    bucketName: asString(payload.bucketName, "unknown-bucket"),
    region: asString(payload.region, "unknown-region"),
    publicAccessBlock,
    policyIsPublic: asBoolean(payload.policyIsPublic),
    aclPublic: asBoolean(payload.aclPublic),
    encryptionEnabled: asBoolean(payload.encryptionEnabled),
    versioningEnabled: asBoolean(payload.versioningEnabled),
  };
}

function toRdsInstanceSecurity(payload: Record<string, unknown>): RdsInstanceSecurityKnowledgePayload {
  return {
    identifier: asString(payload.identifier, "unknown-rds"),
    region: asString(payload.region, "unknown-region"),
    publiclyAccessible: asBoolean(payload.publiclyAccessible),
    storageEncrypted: asBoolean(payload.storageEncrypted),
    masterUserSecretManaged: asBoolean(payload.masterUserSecretManaged),
  };
}

function toSecurityGroupIngress(payload: Record<string, unknown>): SecurityGroupIngressKnowledgePayload {
  const rules = Array.isArray(payload.publicIngress) ? payload.publicIngress : [];
  return {
    groupId: asString(payload.groupId, "unknown-security-group"),
    region: asString(payload.region, "unknown-region"),
    publicIngress: rules
      .filter((rule): rule is Record<string, unknown> => Boolean(rule) && typeof rule === "object")
      .map((rule) => ({
        protocol: asString(rule.protocol, "-1"),
        fromPort: asNullableNumber(rule.fromPort),
        toPort: asNullableNumber(rule.toPort),
        cidr: asString(rule.cidr, "0.0.0.0/0"),
      })),
  };
}

function toEc2InstanceNetwork(payload: Record<string, unknown>): Ec2InstanceNetworkKnowledgePayload {
  const sgIds = Array.isArray(payload.securityGroupIds)
    ? payload.securityGroupIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    instanceId: asString(payload.instanceId, "unknown-instance"),
    region: asString(payload.region, "unknown-region"),
    publicIpAddress: asNullableString(payload.publicIpAddress),
    securityGroupIds: sgIds,
  };
}

export { awsConfigEvidenceId };
