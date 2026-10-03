export const AWS_AUDIT_MODULE = "aws-audit";
export const DEPENDENCY_SCAN_MODULE = "dependency-scan";

export const NOTIFICATION_TYPE = {
  SECURITY_SCAN_DIGEST: "security-scan-digest",
  SECURITY_SPIKE: "security-spike",
} as const;

export const SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const;

// Severity ranking for threshold comparisons; unknown is treated as the
// weakest signal so it never pushes an alert on its own.
export const SEVERITY_LEVEL: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export const SETTING_SINGLETON_ID = 1;
export const DEFAULT_IN_APP_ENABLED = true;
export const DEFAULT_PUSH_ENABLED = false;
export const DEFAULT_MINIMUM_SEVERITY = "high";
export const DEFAULT_SPIKE_ENABLED = true;
export const DEFAULT_SPIKE_THRESHOLD = 5;
export const DEFAULT_SPIKE_BASELINE_DAYS = 7;
export const TOP_FINDINGS_IN_DIGEST = 5;
