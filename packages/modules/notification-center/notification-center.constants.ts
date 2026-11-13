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
export const DEFAULT_NOTIFICATION_PUSH_ENABLED = true;

// --- Delivery rules (ADR-062) ----------------------------------------------

export const DELIVERY_RULE_ACTIONS = ["deliver", "suppress"] as const;
export type DeliveryRuleAction = (typeof DELIVERY_RULE_ACTIONS)[number];

// Why a delivery decision came out the way it did, stored on the audit row so
// every push or suppression is explainable without replaying the rule table.
export const DELIVERY_DECISION_REASONS = ["rule", "no-rule-matched"] as const;
export type DeliveryDecisionReason = (typeof DELIVERY_DECISION_REASONS)[number];

// Why a notification that the rules allowed to deliver was nonetheless kept
// in-app (ADR-063). These are environment facts read at delivery time, kept
// apart from the frozen rule verdict. Listed in evaluation order: the first
// match wins.
export const DELIVERY_RUNTIME_REASONS = [
  "subscription-off",
  "recovery-opt-out",
  "channel-off",
  "silenced",
  "no-port",
] as const;
export type DeliveryRuntimeReason = (typeof DELIVERY_RUNTIME_REASONS)[number];

// Priority of the rule seeded on first boot, and the gap between adjacent
// rules. The UI never shows the number: it drags rows and the API rewrites the
// sequence from the submitted order.
export const DEFAULT_DELIVERY_RULE_PRIORITY = 10;
export const DELIVERY_RULE_PRIORITY_STEP = 10;

/**
 * Default rules seeded when the table is empty, so a fresh install keeps
 * pushing high and critical signals instead of starting from "everything
 * suppressed", and a recovery still announces itself even when its alert was
 * kept in-app. They are ordinary rules: operators can edit or delete them.
 */
export const DEFAULT_DELIVERY_RULE_CONDITION: DeliveryCondition = { severityAtLeast: "high" };
export const DEFAULT_RECOVERY_RULE_PRIORITY = 20;
export const DEFAULT_RECOVERY_RULE_CONDITION: DeliveryCondition = { phase: "recovered" };

/** Outcome of the rule judgement for one alert; frozen on the alert instance. */
export interface DeliveryVerdict {
  action: DeliveryRuleAction;
  ruleId: string | null;
  reason: DeliveryDecisionReason | null;
}

/**
 * Condition of one delivery rule. Absent fields do not filter; an empty
 * collection never matches, so clearing a selector can only narrow the rule
 * (never widen it to "all"). Single values appear only for enumerations and
 * thresholds; collections appear only for multi-select matching.
 */
export interface DeliveryCondition {
  phase?: "firing" | "recovered";
  severityAtLeast?: NotificationSeverity;
  notificationKeys?: string[];
  projectIds?: string[];
  tags?: Record<string, string>;
}

/** Labels of one delivery event, matched against a rule condition. */
export interface DeliveryLabels {
  phase: "firing" | "recovered";
  severity: string;
  notificationKey: string;
  projectId?: string;
  tags?: Record<string, string>;
}

/**
 * True when the event labels satisfy every condition field. An absent or
 * non-object condition matches everything (a rule without a condition is a
 * catch-all).
 */
export function matchesDeliveryCondition(condition: unknown, labels: DeliveryLabels): boolean {
  if (!condition || typeof condition !== "object") {
    return true;
  }
  const rule = condition as DeliveryCondition;
  if (rule.phase && rule.phase !== labels.phase) {
    return false;
  }
  if (rule.severityAtLeast) {
    const required = SEVERITY_LEVEL[rule.severityAtLeast];
    const actual = SEVERITY_LEVEL[labels.severity];
    if (required === undefined || actual === undefined || actual < required) {
      return false;
    }
  }
  if (rule.notificationKeys) {
    if (rule.notificationKeys.length === 0 || !rule.notificationKeys.includes(labels.notificationKey)) {
      return false;
    }
  }
  if (rule.projectIds) {
    if (rule.projectIds.length === 0 || !labels.projectId || !rule.projectIds.includes(labels.projectId)) {
      return false;
    }
  }
  if (rule.tags) {
    const entries = Object.entries(rule.tags);
    if (entries.length === 0 || !labels.tags) {
      return false;
    }
    if (!entries.every(([key, value]) => labels.tags?.[key] === value)) {
      return false;
    }
  }
  return true;
}

const CONDITION_FIELDS = ["phase", "severityAtLeast", "notificationKeys", "projectIds", "tags"] as const;
const CONDITION_PHASES = ["firing", "recovered"] as const;

/**
 * Validate a condition submitted through the API. `condition` is a JSON column,
 * so this is the only thing standing between a malformed payload and a rule
 * that silently never matches. Returns the problems found; empty means valid.
 */
export function validateDeliveryCondition(condition: unknown): string[] {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    return ["condition must be an object"];
  }
  const rule = condition as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(rule)) {
    if (!(CONDITION_FIELDS as readonly string[]).includes(key)) {
      problems.push(`unknown condition field: ${key}`);
    }
  }
  if (rule.phase !== undefined && !(CONDITION_PHASES as readonly unknown[]).includes(rule.phase)) {
    problems.push(`phase must be one of ${CONDITION_PHASES.join(", ")}`);
  }
  if (rule.severityAtLeast !== undefined && !(SEVERITIES as readonly unknown[]).includes(rule.severityAtLeast)) {
    problems.push(`severityAtLeast must be one of ${SEVERITIES.join(", ")}`);
  }
  for (const key of ["notificationKeys", "projectIds"] as const) {
    const value = rule[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
      problems.push(`${key} must be an array of non-empty strings`);
    }
  }
  if (rule.tags !== undefined) {
    const tags = rule.tags;
    if (tags === null || typeof tags !== "object" || Array.isArray(tags)) {
      problems.push("tags must be an object of string values");
    } else if (Object.values(tags).some((value) => typeof value !== "string")) {
      problems.push("tags must be an object of string values");
    }
  }
  return problems;
}

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
