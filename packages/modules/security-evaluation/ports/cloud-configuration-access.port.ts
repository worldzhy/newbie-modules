import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * CloudConfigurationAccess — the host-provided read-only view of a
 * aws-account asset (ADR-027 D1).
 *
 * The port yields raw configuration facts, never judged results: whether a
 * password policy or a bucket is compliant is the module's decision, made by
 * the CLOUD_CONFIG judgment against the criteria version. The host owns
 * credentials and SDK access; a deployment without cloud accounts simply does
 * not bind the token (assembly error, like the skeleton's own SPI ports).
 */
export const securityEvaluationCloudConfigurationAccessToken = "SECURITY_EVALUATION_CLOUD_CONFIGURATION_ACCESS";

/** One configuration fact, in the asset-fact vocabulary (ADR-027 D2). */
export interface CloudConfigurationFact {
  /** Module-owned vocabulary, e.g. "aws.iam.root-credential". */
  factType: string;
  /** Stable identity inside the subject, e.g. a bucket name or "root". */
  factKey: string;
  /** The raw configuration projection; never a pass/fail conclusion. */
  value: Record<string, unknown>;
}

/** A fact group the collector could not gather, with the reason attached. */
export interface CloudConfigurationFailure {
  factType: string;
  /** Absent means the whole fact type failed; present means one resource. */
  factKey?: string;
  reason: string;
}

export interface CloudConfigurationFactCollection {
  facts: CloudConfigurationFact[];
  failures: CloudConfigurationFailure[];
}

export interface CloudConfigurationAccess {
  collectFacts(subject: EvaluationSubjectRef): Promise<CloudConfigurationFactCollection>;
}
