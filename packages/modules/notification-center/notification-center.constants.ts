import type { EvaluationFindingSeverity } from "@modules/evaluation/ports/evaluation.contracts";
import { SEVERITIES as EVALUATION_SEVERITIES, SEVERITY_RANK } from "@modules/evaluation/evaluation-severity.util";

/** Lower-case notification vocabulary derived from the shared evaluation set. */
export type NotificationSeverity = Lowercase<EvaluationFindingSeverity>;
export const SEVERITIES: NotificationSeverity[] = EVALUATION_SEVERITIES.map(
  (severity) => severity.toLowerCase() as NotificationSeverity,
);

// Severity ranking for threshold comparisons; info is treated as the
// weakest signal so it never pushes an alert on its own.
export const SEVERITY_LEVEL: Record<string, number> = Object.fromEntries(
  EVALUATION_SEVERITIES.map((severity) => [severity.toLowerCase(), SEVERITY_RANK[severity]]),
);

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

// Injection token for the host-provided visibility adapter. Notification records
// are platform-wide rows; the host knows which projects a user belongs to, so it
// supplies this port to keep project-scoped rows scoped to their members.
export const NOTIFICATION_VISIBILITY_PORT = "NOTIFICATION_VISIBILITY_PORT";

export interface NotificationVisibilityPort {
  /** Project ids the caller is a member of. An empty array means "none". */
  visibleProjectIds(userId: string): Promise<string[]>;
}

// Postgres unique violation code, used to treat concurrent declaration of the
// same notification as a no-op.
export const PG_UNIQUE_VIOLATION = "P2002";
