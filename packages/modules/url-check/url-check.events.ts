import { defineEvent } from "@modules/event-emitter/event-definition";

/** Fired when a target crosses into an alert-open state. */
export const URL_CHECK_DOWN_EVENT = "url-check.down";

/** Fired when a target recovers from an open alert. */
export const URL_CHECK_RECOVERED_EVENT = "url-check.recovered";

/** Fired when a target stops being probed while its alert is still open. */
export const URL_CHECK_TARGET_CLOSED_EVENT = "url-check.target-closed";

/** Fired when a target crosses into an alert-open state. */
export interface UrlCheckDownEvent {
  targetId: string;
  groupId: string;
  name: string;
  url: string;
  error: string;
  consecutiveFailures: number;
  downSince: string; // ISO timestamp
}

/** Fired when a target recovers from an open alert. */
export interface UrlCheckRecoveredEvent {
  targetId: string;
  groupId: string;
  name: string;
  url: string;
  downSince: string; // ISO timestamp, empty when the alert's openAt is null
  recoveredAt: string;
  downtimeMinutes: number;
}

/**
 * Fired when a target stops being probed (paused or deleted) while an alert is
 * still firing. `alertOpenedAt` is the outage start the alert was opened with;
 * a non-null value means the lifecycle lost its producer and must be closed
 * silently by the host.
 */
export interface UrlCheckTargetClosedEvent {
  targetId: string;
  groupId: string;
  name: string;
  url: string;
  alertOpenedAt: string;
  cause: "paused" | "deleted";
}

const URL_CHECK_DOWN = defineEvent<UrlCheckDownEvent>({
  key: URL_CHECK_DOWN_EVENT,
  name: "URL check target down",
  description: "Emitted when a target crosses into an alert-open state after consecutive probe failures.",
  payloadExample: {
    targetId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    groupId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    name: "Marketing site",
    url: "https://example.com/health",
    error: "HTTP 503",
    consecutiveFailures: 3,
    downSince: "2026-01-01T00:00:00.000Z",
  },
});

const URL_CHECK_RECOVERED = defineEvent<UrlCheckRecoveredEvent>({
  key: URL_CHECK_RECOVERED_EVENT,
  name: "URL check target recovered",
  description: "Emitted when a target recovers from an open alert after consecutive probe successes.",
  payloadExample: {
    targetId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    groupId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    name: "Marketing site",
    url: "https://example.com/health",
    downSince: "2026-01-01T00:00:00.000Z",
    recoveredAt: "2026-01-01T00:15:00.000Z",
    downtimeMinutes: 15,
  },
});

const URL_CHECK_TARGET_CLOSED = defineEvent<UrlCheckTargetClosedEvent>({
  key: URL_CHECK_TARGET_CLOSED_EVENT,
  name: "URL check target stopped probing",
  description:
    "Emitted when a target is paused or deleted while its alert is still firing; the host closes a lifecycle it can no longer resolve.",
  payloadExample: {
    targetId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    groupId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    name: "Marketing site",
    url: "https://example.com/health",
    alertOpenedAt: "2026-01-01T00:00:00.000Z",
    cause: "paused",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const urlCheckEventDeclarations = [URL_CHECK_DOWN, URL_CHECK_RECOVERED, URL_CHECK_TARGET_CLOSED];
