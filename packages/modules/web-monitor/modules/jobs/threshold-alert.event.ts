import { defineEvent } from "@modules/event-emitter/event-definition";

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

export type WebThresholdAlertSignal =
  "slow-page" | "slow-first-paint" | "slow-resource" | "slow-ajax" | "js-error-spike" | "js-error-first-seen";

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
  /** Distinct affected visitors (markUser) in the window, when the signal tracks it. */
  affectedUsers?: number;
  /** Breached millisecond threshold (performance signals only). */
  thresholdMs?: number;
  /** Evaluation window size in milliseconds. */
  windowMs: number;
  /** ISO timestamp of the evaluated window start, also used for dedupe bucketing. */
  windowStartedAt: string;
  /** Pre-rendered top offender lines for the notification detail body. */
  topItems: string[];
  /** Error name for fingerprint-based signals (js-error-first-seen). */
  errorName?: string;
  /** Error resource URL for fingerprint-based signals (js-error-first-seen). */
  resourceUrl?: string;
  /** Stable fingerprint of a first-seen error, appended to the dedupe bucket. */
  fingerprint?: string;
}

const WEB_THRESHOLD_ALERT = defineEvent<WebThresholdAlertEvent>({
  key: WEB_THRESHOLD_ALERT_EVENT,
  name: "Web monitor threshold alert",
  description: "Emitted when a monitored system breaches a performance or error threshold in the evaluation window.",
  payloadExample: {
    appId: "storefront-web",
    systemName: "Storefront Web",
    projectId: "00000000-0000-0000-0000-000000000000",
    signal: "slow-page",
    severity: "high",
    count: 12,
    affectedUsers: 8,
    thresholdMs: 3000,
    windowMs: 60000,
    windowStartedAt: "2026-01-01T00:00:00.000Z",
    topItems: ["/dashboard — 4200ms avg, 12 occurrence(s)"],
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const webMonitorEventDeclarations = [WEB_THRESHOLD_ALERT];
