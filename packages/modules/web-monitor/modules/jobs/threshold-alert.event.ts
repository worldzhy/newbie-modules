/**
 * Domain event emitted by the scheduled threshold-alert evaluation when a
 * monitored system breaches a performance or error threshold inside the
 * evaluation window.
 *
 * The web-monitor module only emits; application-layer subscribers decide how
 * the event becomes a user-facing notification (mirrors the job-scheduler
 * run-failed event pattern).
 */
export const WEB_THRESHOLD_ALERT_EVENT = "web-monitor.threshold-alert";

export type WebThresholdAlertSignal = "slow-page" | "slow-resource" | "slow-ajax" | "js-error-spike";

export type WebThresholdAlertCategory = "js" | "css" | "img";

export interface WebThresholdAlertEvent {
  /** System partition key (browser SDK appKey). */
  appId: string;
  systemName: string;
  projectId?: string;
  signal: WebThresholdAlertSignal;
  /** Set for slow-resource alerts to distinguish JS/CSS/image resources. */
  category?: WebThresholdAlertCategory;
  severity: "medium" | "high";
  /** Breaching occurrences observed in the window. */
  count: number;
  /** Breached millisecond threshold (performance signals only). */
  thresholdMs?: number;
  /** Evaluation window size in milliseconds. */
  windowMs: number;
  /** ISO timestamp of the evaluated window start, also used for dedupe bucketing. */
  windowStartedAt: string;
  /** Pre-rendered top offender lines for the notification detail body. */
  topItems: string[];
}
