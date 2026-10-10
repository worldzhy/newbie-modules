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

export const CENTER_SETTING_SINGLETON_ID = 1;
export const DEFAULT_PUSH_ENABLED = false;
export const DEFAULT_MINIMUM_SEVERITY = "high";
export const DEFAULT_NOTIFICATION_PUSH_ENABLED = true;

// Delivery scope of a notification. "system" notifications are platform-wide
// (no owning project) and are configured at the top level; "project"
// notifications are produced by a project and routed to that project's bound
// chats by the host.
export const NOTIFICATION_SCOPES = ["system", "project"] as const;
export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];
export const DEFAULT_NOTIFICATION_SCOPE: NotificationScope = "project";

// Injection token for the host-provided push adapter. The notification-center
// module owns in-app delivery and per-notification settings; the actual chat
// push is supplied by the host application, which knows its chat platform.
export const NOTIFICATION_PUSH_PORT = "NOTIFICATION_PUSH_PORT";

// Postgres unique violation code, used to treat concurrent declaration of the
// same notification as a no-op.
export const PG_UNIQUE_VIOLATION = "P2002";
