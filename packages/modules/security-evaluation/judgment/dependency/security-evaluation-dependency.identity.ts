import { SECURITY_EVALUATION_ECOSYSTEM_NPM } from "../../security-evaluation.constants";

/**
 * Identity helpers for the dependency judgment, kept pure so the stability of
 * finding fingerprints is testable without a database.
 */

/** Knowledge key of an installed package: `npm:<name>@<version>`. */
export function dependencyKnowledgeKey(packageName: string, version: string): string {
  return `${SECURITY_EVALUATION_ECOSYSTEM_NPM}:${packageName}@${version}`;
}

/** Manifest item id of one installed package: `pkg:npm:<name>@<version>`. */
export function dependencyEvidenceId(packageName: string, version: string): string {
  return `pkg:${dependencyKnowledgeKey(packageName, version)}`;
}

/**
 * Stable finding identity: `<ecosystem>:<name>:<vulnerabilityId>`.
 *
 * Deliberately version-free: an upgrade that lands on another still-affected
 * version keeps the same finding open, matching the predecessor module's
 * semantics. A fixed version therefore resolves the finding through the
 * absence of the vulnerability, not through a new fingerprint.
 */
export function dependencyFingerprint(packageName: string, vulnerabilityId: string): string {
  return `${SECURITY_EVALUATION_ECOSYSTEM_NPM}:${packageName}:${vulnerabilityId}`;
}
