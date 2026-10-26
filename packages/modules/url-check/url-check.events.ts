import { defineEvent } from "@modules/event-emitter/event-definition";

/** Fired when a target crosses into an alert-open state. */
export const URL_CHECK_DOWN_EVENT = "url-check.down";

/** Fired when a target recovers from an open alert. */
export const URL_CHECK_RECOVERED_EVENT = "url-check.recovered";

/** Fired when a target crosses into an alert-open state. */
export interface UrlCheckDownEvent {
  targetId: string;
  projectId: string;
  name: string;
  url: string;
  error: string;
  consecutiveFailures: number;
  downSince: string; // ISO timestamp
}

/** Fired when a target recovers from an open alert. */
export interface UrlCheckRecoveredEvent {
  targetId: string;
  projectId: string;
  name: string;
  url: string;
  downSince: string; // ISO timestamp, empty when the alert's openAt is null
  recoveredAt: string;
  downtimeMinutes: number;
}

const URL_CHECK_DOWN = defineEvent<UrlCheckDownEvent>({
  key: URL_CHECK_DOWN_EVENT,
  name: "URL check target down",
  description: "Emitted when a target crosses into an alert-open state after consecutive probe failures.",
  payloadExample: {
    targetId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
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
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    name: "Marketing site",
    url: "https://example.com/health",
    downSince: "2026-01-01T00:00:00.000Z",
    recoveredAt: "2026-01-01T00:15:00.000Z",
    downtimeMinutes: 15,
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const urlCheckEventDeclarations = [URL_CHECK_DOWN, URL_CHECK_RECOVERED];
