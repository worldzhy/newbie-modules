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
export const DEFAULT_TYPE_PUSH_ENABLED = true;

// Postgres unique violation code, used to treat concurrent declaration of the
// same notification type as a no-op.
export const PG_UNIQUE_VIOLATION = "P2002";
