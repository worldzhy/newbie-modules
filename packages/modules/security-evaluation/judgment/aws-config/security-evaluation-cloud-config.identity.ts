/**
 * Identity helpers for the CLOUD_CONFIG judgment, kept pure so the stability
 * of finding fingerprints is testable without a database (ADR-027 D6).
 */

/** Manifest item id of one configuration knowledge item: `cloud:<type>:<key>`. */
export function cloudConfigEvidenceId(type: string, key: string): string {
  return `cloud:${type}:${key}`;
}

/**
 * Stable finding identity: `aws:<criterionKey>:<resourceKey>`.
 *
 * Deliberately version-free: a re-audit that finds the same resource still
 * non-compliant keeps the same finding open, and remediation resolves the
 * finding through its absence, never through a new fingerprint.
 */
export function cloudConfigFingerprint(criterionKey: string, resourceKey: string): string {
  return `aws:${criterionKey}:${resourceKey}`;
}
