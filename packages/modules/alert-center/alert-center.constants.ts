import { createHash } from "node:crypto";

/**
 * Severity vocabulary of the alert domain (ADR-062 "severity contract"): the
 * producer owns the value, the notification domain owns what it triggers. Each
 * registry module declares its own isomorphic union instead of sharing a
 * TypeScript type across module boundaries.
 */
export const ALERT_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Lifecycle values shared with the notification port and its rule conditions. */
export const ALERT_STATES = ["firing", "resolved"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

/** Reminder rhythm used when neither the source registration nor the row overrides it. */
export const DEFAULT_REPEAT_MINUTES = 60;

/** Injection token of the host-provided notification adapter (ADR-065 §5). */
export const ALERT_NOTIFICATION_PORT = "ALERT_NOTIFICATION_PORT";

/** Postgres unique violation, used as the fingerprint arbitration point. */
export const PG_UNIQUE_VIOLATION = "P2002";

// Width of Alert.fingerprint (VarChar(255)).
const FINGERPRINT_MAX_LENGTH = 255;
const FINGERPRINT_HASH_LENGTH = 64;

/** Runtime membership check for a severity crossing the port boundary. */
export function isAlertSeverity(value: unknown): value is AlertSeverity {
  return typeof value === "string" && (ALERT_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Identity key of one alert lifecycle: scope, source and the caller's key.
 * Every source keeps its own alerts (no cross-source merging), so a "the app
 * is down" row and a "the database is down" row never collapse into one.
 * Values beyond the column width are hashed instead of failing the insert.
 */
export function buildAlertFingerprint(input: { scopeId?: string; source: string; alertKey: string }): string {
  const scoped = `${input.scopeId ?? "-"}:${input.source}:${input.alertKey}`;
  if (scoped.length <= FINGERPRINT_MAX_LENGTH) {
    return scoped;
  }
  const prefixLength = FINGERPRINT_MAX_LENGTH - FINGERPRINT_HASH_LENGTH - 1;
  return `${scoped.slice(0, prefixLength)}:${createHash("sha256").update(scoped).digest("hex")}`;
}

/**
 * A pause that has not expired yet suppresses external delivery but never
 * recording: an alert paused during a maintenance window still exists and can
 * still resolve.
 */
export function isNotificationPaused(pausedUntil: Date | null | undefined, now: Date): boolean {
  return Boolean(pausedUntil && pausedUntil > now);
}

/**
 * First reminder after an alert opens or reopens. A paused source pushes that
 * moment past the end of the pause so the operator gets one late reminder
 * instead of a burst of the ones missed meanwhile (ADR-065 §4).
 */
export function nextNotificationAt(pausedUntil: Date | null | undefined, repeatMinutes: number, now: Date): Date {
  const base = isNotificationPaused(pausedUntil, now) && pausedUntil ? pausedUntil : now;
  return new Date(base.getTime() + repeatMinutes * 60_000);
}

/** Host-provided adapter that turns one alert lifecycle event into a notification. */
export interface AlertNotificationPort {
  notify(event: {
    alertId: string;
    source: string;
    scopeId?: string;
    state: AlertState;
    severity: AlertSeverity;
    labels: Record<string, string>;
    data: Record<string, unknown> | null;
    /**
     * Start of the current lifecycle (`Alert.firstSeenAt`): constant across the
     * firing message, its reminders and the matching resolve, and advanced when
     * a resolved alert reopens. It is the occurrence dimension of the delivery
     * identity, so the adapter must carry it into `deduplicationKey` instead of
     * deriving uniqueness from the alert row, whose id survives a reopen
     * (ADR-065 §3/§4).
     */
    lifecycleStartedAt: Date;
    /**
     * 0 for the first firing delivery, then 1-based reminder number. Reminders
     * reuse the firing `notificationKey` and template; only the rendered title
     * and the record-level deduplication key change, so per-key switches and
     * delivery rules stay stable (ADR-065 §4).
     */
    reminderCount: number;
  }): Promise<void>;
}
