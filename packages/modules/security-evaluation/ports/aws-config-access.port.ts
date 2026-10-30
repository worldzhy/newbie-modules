import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * AwsConfigAccess — the host-provided read-only view of a
 * aws-account asset (ADR-027 D1).
 *
 * The port yields raw configuration knowledge items, never judged results:
 * whether a password policy or a bucket is compliant is the module's decision,
 * made by the aws-config judgment against the criteria version. The host owns
 * credentials and SDK access; a deployment without cloud accounts simply does
 * not bind the token (assembly error, like the skeleton's own SPI ports).
 */
export const securityEvaluationAwsConfigAccessToken = "SECURITY_EVALUATION_AWS_CONFIG_ACCESS";

/** One configuration knowledge item, in the asset-knowledge vocabulary (ADR-027 D2). */
export interface AwsConfigItem {
  /** Module-owned vocabulary, e.g. "aws.iam.root-credential". */
  type: string;
  /** Stable identity inside the subject, e.g. a bucket name or "root". */
  key: string;
  /** The raw configuration projection; never a pass/fail conclusion. */
  value: Record<string, unknown>;
}

/** A knowledge group the collector could not gather, with the reason attached. */
export interface AwsConfigFailure {
  type: string;
  /** Absent means the whole knowledge type failed; present means one resource. */
  key?: string;
  reason: string;
}

export interface AwsConfigCollection {
  items: AwsConfigItem[];
  failures: AwsConfigFailure[];
}

export interface AwsConfigAccess {
  collect(subject: EvaluationSubjectRef): Promise<AwsConfigCollection>;
}
