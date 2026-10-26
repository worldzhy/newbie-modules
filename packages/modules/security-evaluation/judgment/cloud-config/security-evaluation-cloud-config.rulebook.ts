import type { SecurityEvaluationFindingSeverity } from "../security-evaluation-severity";
import {
  SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
  SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
  SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ROOT_CREDENTIAL,
  SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_USER_CREDENTIAL,
  SECURITY_EVALUATION_FACT_TYPE_AWS_RDS_INSTANCE_SECURITY,
  SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY,
} from "../../security-evaluation.constants";
import { cloudConfigEvidenceId } from "./security-evaluation-cloud-config.identity";

/**
 * The CIS AWS Foundations Benchmark v1.5 rulebook (ADR-027 D3): one control =
 * one ASSERTION criterion, judged by a deterministic pure function over the
 * collected facts. PASS produces nothing; FAIL produces one finding draft per
 * non-compliant resource.
 *
 * Rule semantics mirror the predecessor aws-audit module's checks so the two
 * reports agree while they coexist (ADR-022 coexistence boundary).
 */

/** Typed fact payloads, reconstructed from evidence item payloads. */
export interface PasswordPolicyFactPayload {
  exists: boolean;
  minimumPasswordLength: number | null;
  maxPasswordAgeDays: number | null;
  expirePasswords: boolean;
}

export interface RootCredentialFactPayload {
  passwordEnabled: boolean;
  mfaActive: boolean;
  activeAccessKeyCount: number;
}

export interface UserCredentialFactPayload {
  userName: string;
  passwordEnabled: boolean;
  mfaActive: boolean;
}

export interface BucketSecurityFactPayload {
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
}

export interface RdsInstanceSecurityFactPayload {
  identifier: string;
  region: string;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
}

export interface SecurityGroupPublicIngressRule {
  protocol: string;
  fromPort: number | null;
  toPort: number | null;
  cidr: string;
}

export interface SecurityGroupIngressFactPayload {
  groupId: string;
  region: string;
  /** Only internet-open rules (0.0.0.0/0 or ::/0); empty means none. */
  publicIngress: SecurityGroupPublicIngressRule[];
}

/** A fact as the judges see it: typed payload plus its manifest identity. */
export interface CloudConfigFact<T> {
  evidenceId: string;
  factKey: string;
  payload: T;
}

export interface CloudConfigFactSet {
  passwordPolicy: CloudConfigFact<PasswordPolicyFactPayload> | null;
  rootCredential: CloudConfigFact<RootCredentialFactPayload> | null;
  userCredentials: CloudConfigFact<UserCredentialFactPayload>[];
  buckets: CloudConfigFact<BucketSecurityFactPayload>[];
  rdsInstances: CloudConfigFact<RdsInstanceSecurityFactPayload>[];
  securityGroups: CloudConfigFact<SecurityGroupIngressFactPayload>[];
}

export interface CloudConfigFindingDraft {
  resourceKey: string;
  factType: string;
  region?: string;
  title: string;
  detail: string;
  evidenceRefs: string[];
}

export interface CloudConfigRulebookEntry {
  criterionKey: string;
  controlId: string;
  name: string;
  severity: SecurityEvaluationFindingSeverity;
  remediation: string;
  requiredFactTypes: readonly string[];
  judge(facts: CloudConfigFactSet): CloudConfigFindingDraft[];
}

/** Ports whose internet-open ingress CIS treats as management exposure. */
export const SECURITY_EVALUATION_CLOUD_CONFIG_SENSITIVE_PORTS = [22, 3389, 3306, 5432, 6379, 27017, 9200] as const;

const PASSWORD_MIN_LENGTH = 14;

function rootCredentialEntry(
  partial: Omit<CloudConfigRulebookEntry, "requiredFactTypes" | "judge">,
  fail: (fact: RootCredentialFactPayload) => string | null,
): CloudConfigRulebookEntry {
  return {
    ...partial,
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ROOT_CREDENTIAL],
    judge(facts) {
      const fact = facts.rootCredential;
      if (!fact) return [];
      const reason = fail(fact.payload);
      if (!reason) return [];
      return [
        {
          resourceKey: "root",
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ROOT_CREDENTIAL,
          title: partial.name,
          detail: reason,
          evidenceRefs: [fact.evidenceId],
        },
      ];
    },
  };
}

function passwordPolicyEntry(
  partial: Omit<CloudConfigRulebookEntry, "requiredFactTypes" | "judge">,
  fail: (fact: PasswordPolicyFactPayload) => string | null,
): CloudConfigRulebookEntry {
  return {
    ...partial,
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY],
    judge(facts) {
      const fact = facts.passwordPolicy;
      if (!fact) return [];
      const reason = fail(fact.payload);
      if (!reason) return [];
      return [
        {
          resourceKey: "account-password-policy",
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY,
          title: partial.name,
          detail: reason,
          evidenceRefs: [fact.evidenceId],
        },
      ];
    },
  };
}

function securityGroupHasManagementExposure(rule: SecurityGroupPublicIngressRule): boolean {
  if (rule.protocol === "-1") return true;
  const fromPort = rule.fromPort ?? -1;
  const toPort = rule.toPort ?? -1;
  return SECURITY_EVALUATION_CLOUD_CONFIG_SENSITIVE_PORTS.some((port) => port >= fromPort && port <= toPort);
}

function describePublicIngress(rule: SecurityGroupPublicIngressRule): string {
  const ports = rule.protocol === "-1" ? "all ports" : `${rule.protocol} ${rule.fromPort ?? "?"}-${rule.toPort ?? "?"}`;
  return `${rule.cidr} -> ${ports}`;
}

export const SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK: readonly CloudConfigRulebookEntry[] = [
  rootCredentialEntry(
    {
      criterionKey: "cis-1-4",
      controlId: "1.4",
      name: "Root account has no active access keys",
      severity: "HIGH",
      remediation: "Remove root access keys and use IAM roles or IAM users instead.",
    },
    (fact) =>
      fact.activeAccessKeyCount > 0
        ? `The root account still has ${fact.activeAccessKeyCount} active access key(s).`
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
    (fact) =>
      fact.passwordEnabled && !fact.mfaActive ? "Root console access is enabled but MFA is not active." : null,
  ),
  {
    criterionKey: "cis-1-8",
    controlId: "1.8",
    name: "IAM console users have MFA enabled",
    severity: "MEDIUM",
    remediation: "Require MFA for every console-capable IAM user.",
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_USER_CREDENTIAL],
    judge(facts) {
      return facts.userCredentials
        .filter((fact) => fact.payload.passwordEnabled && !fact.payload.mfaActive)
        .map((fact) => ({
          resourceKey: fact.payload.userName,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_USER_CREDENTIAL,
          title: `IAM console user ${fact.payload.userName} does not have MFA enabled`,
          detail: `User ${fact.payload.userName} has console password access without MFA.`,
          evidenceRefs: [fact.evidenceId],
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
    (fact) =>
      !fact.exists
        ? "No account password policy is configured."
        : (fact.minimumPasswordLength ?? 0) < PASSWORD_MIN_LENGTH
          ? `The minimum password length is ${fact.minimumPasswordLength ?? 0}, below ${PASSWORD_MIN_LENGTH}.`
          : null,
  ),
  passwordPolicyEntry(
    {
      criterionKey: "cis-1-15",
      controlId: "1.15",
      name: "IAM password policy expires passwords",
      severity: "MEDIUM",
      remediation: "Set maxPasswordAge so console passwords expire.",
    },
    (fact) =>
      !fact.exists
        ? "No account password policy is configured."
        : !fact.expirePasswords || !fact.maxPasswordAgeDays
          ? "The account password policy does not enforce password expiration."
          : null,
  ),
  {
    criterionKey: "cis-2-1-1",
    controlId: "2.1.1",
    name: "S3 buckets have default encryption enabled",
    severity: "MEDIUM",
    remediation: "Enable SSE-S3 or SSE-KMS for default bucket encryption.",
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY],
    judge(facts) {
      return facts.buckets
        .filter((fact) => !fact.payload.encryptionEnabled)
        .map((fact) => ({
          resourceKey: fact.payload.bucketName,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY,
          region: fact.payload.region,
          title: `S3 bucket ${fact.payload.bucketName} does not have default encryption enabled`,
          detail: `Bucket ${fact.payload.bucketName} does not report a default server-side encryption rule.`,
          evidenceRefs: [fact.evidenceId],
        }));
    },
  },
  {
    criterionKey: "cis-2-1-2",
    controlId: "2.1.2",
    name: "S3 buckets block public access",
    severity: "HIGH",
    remediation: "Enable every Public Access Block flag and remove public bucket policies or ACL grants.",
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY],
    judge(facts) {
      const drafts: CloudConfigFindingDraft[] = [];
      for (const fact of facts.buckets) {
        const bucket = fact.payload;
        const gaps: string[] = [];
        if (!bucket.publicAccessBlock?.configured) {
          gaps.push("no Public Access Block configuration");
        } else if (
          !bucket.publicAccessBlock.blockPublicAcls ||
          !bucket.publicAccessBlock.ignorePublicAcls ||
          !bucket.publicAccessBlock.blockPublicPolicy ||
          !bucket.publicAccessBlock.restrictPublicBuckets
        ) {
          gaps.push("Public Access Block is partially disabled");
        }
        if (bucket.policyIsPublic) gaps.push("the bucket policy is evaluated by AWS as public");
        if (bucket.aclPublic) gaps.push("the bucket ACL grants public access");
        if (gaps.length === 0) continue;
        drafts.push({
          resourceKey: bucket.bucketName,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY,
          region: bucket.region,
          title: `S3 bucket ${bucket.bucketName} allows public access`,
          detail: `Bucket ${bucket.bucketName}: ${gaps.join("; ")}.`,
          evidenceRefs: [fact.evidenceId],
        });
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
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_RDS_INSTANCE_SECURITY],
    judge(facts) {
      const drafts: CloudConfigFindingDraft[] = [];
      for (const fact of facts.rdsInstances) {
        const instance = fact.payload;
        const gaps: string[] = [];
        if (instance.publiclyAccessible) gaps.push("publicly accessible");
        if (!instance.storageEncrypted) gaps.push("storage encryption disabled");
        if (gaps.length === 0) continue;
        drafts.push({
          resourceKey: instance.identifier,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_RDS_INSTANCE_SECURITY,
          region: instance.region,
          title: `RDS instance ${instance.identifier} is ${gaps.join(" and ")}`,
          detail: `RDS instance ${instance.identifier} is ${gaps.join(" and ")}.`,
          evidenceRefs: [fact.evidenceId],
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
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS],
    judge(facts) {
      const drafts: CloudConfigFindingDraft[] = [];
      for (const fact of facts.securityGroups) {
        const group = fact.payload;
        const offending = group.publicIngress.filter(securityGroupHasManagementExposure);
        if (offending.length === 0) continue;
        drafts.push({
          resourceKey: group.groupId,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
          region: group.region,
          title: `Security group ${group.groupId} exposes management access to the internet`,
          detail: `Security group ${group.groupId} allows ${offending.map(describePublicIngress).join("; ")}.`,
          evidenceRefs: [fact.evidenceId],
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
    requiredFactTypes: [SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS],
    judge(facts) {
      return facts.securityGroups
        .filter((fact) => fact.payload.publicIngress.length > 0)
        .map((fact) => ({
          resourceKey: fact.payload.groupId,
          factType: SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS,
          region: fact.payload.region,
          title: `Security group ${fact.payload.groupId} has public ingress`,
          detail: `Security group ${fact.payload.groupId} allows ${fact.payload.publicIngress
            .map(describePublicIngress)
            .join("; ")}.`,
          evidenceRefs: [fact.evidenceId],
        }));
    },
  },
];

export const SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK = "CIS AWS Foundations Benchmark v1.5";

/** Rebuild the typed fact set from manifest items (payloads cross the port as JSON). */
export function rebuildCloudConfigFacts(
  items: readonly { id: string; payload?: Record<string, unknown> }[],
): CloudConfigFactSet {
  const set: CloudConfigFactSet = {
    passwordPolicy: null,
    rootCredential: null,
    userCredentials: [],
    buckets: [],
    rdsInstances: [],
    securityGroups: [],
  };
  for (const item of items) {
    const payload = item.payload ?? {};
    const factKey = cloudFactKeyFromEvidenceId(item.id);
    switch (payload.factType) {
      case SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ACCOUNT_PASSWORD_POLICY:
        set.passwordPolicy = { evidenceId: item.id, factKey, payload: toPasswordPolicy(payload) };
        break;
      case SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_ROOT_CREDENTIAL:
        set.rootCredential = { evidenceId: item.id, factKey, payload: toRootCredential(payload) };
        break;
      case SECURITY_EVALUATION_FACT_TYPE_AWS_IAM_USER_CREDENTIAL:
        set.userCredentials.push({ evidenceId: item.id, factKey, payload: toUserCredential(payload) });
        break;
      case SECURITY_EVALUATION_FACT_TYPE_AWS_S3_BUCKET_SECURITY:
        set.buckets.push({ evidenceId: item.id, factKey, payload: toBucketSecurity(payload) });
        break;
      case SECURITY_EVALUATION_FACT_TYPE_AWS_RDS_INSTANCE_SECURITY:
        set.rdsInstances.push({ evidenceId: item.id, factKey, payload: toRdsInstanceSecurity(payload) });
        break;
      case SECURITY_EVALUATION_FACT_TYPE_AWS_EC2_SECURITY_GROUP_INGRESS:
        set.securityGroups.push({ evidenceId: item.id, factKey, payload: toSecurityGroupIngress(payload) });
        break;
      default:
        break;
    }
  }
  return set;
}

function cloudFactKeyFromEvidenceId(evidenceId: string): string {
  // ids are `cloud:<factType>:<factKey>`; the fact key itself never contains
  // "cloud:" or a fact type, so stripping the known prefix is safe.
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

function toPasswordPolicy(payload: Record<string, unknown>): PasswordPolicyFactPayload {
  return {
    exists: asBoolean(payload.exists),
    minimumPasswordLength: asNullableNumber(payload.minimumPasswordLength),
    maxPasswordAgeDays: asNullableNumber(payload.maxPasswordAgeDays),
    expirePasswords: asBoolean(payload.expirePasswords),
  };
}

function toRootCredential(payload: Record<string, unknown>): RootCredentialFactPayload {
  return {
    passwordEnabled: asBoolean(payload.passwordEnabled),
    mfaActive: asBoolean(payload.mfaActive),
    activeAccessKeyCount: asNullableNumber(payload.activeAccessKeyCount) ?? 0,
  };
}

function toUserCredential(payload: Record<string, unknown>): UserCredentialFactPayload {
  return {
    userName: asString(payload.userName, "unknown-user"),
    passwordEnabled: asBoolean(payload.passwordEnabled),
    mfaActive: asBoolean(payload.mfaActive),
  };
}

function toBucketSecurity(payload: Record<string, unknown>): BucketSecurityFactPayload {
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
  };
}

function toRdsInstanceSecurity(payload: Record<string, unknown>): RdsInstanceSecurityFactPayload {
  return {
    identifier: asString(payload.identifier, "unknown-rds"),
    region: asString(payload.region, "unknown-region"),
    publiclyAccessible: asBoolean(payload.publiclyAccessible),
    storageEncrypted: asBoolean(payload.storageEncrypted),
  };
}

function toSecurityGroupIngress(payload: Record<string, unknown>): SecurityGroupIngressFactPayload {
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

export { cloudConfigEvidenceId };
