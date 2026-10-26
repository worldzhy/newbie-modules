import { defineEvent } from "@modules/event-emitter/event-definition";

/** Emitted after a scan completes successfully and its findings are persisted. */
export const DEPENDENCY_SCAN_COMPLETED_EVENT = "dependency-scan.scan-completed";

/** Emitted after a scan fails and the failure is persisted. */
export const DEPENDENCY_SCAN_FAILED_EVENT = "dependency-scan.scan-failed";

export interface DependencyScanCompletedEvent {
  applicationId: string;
  projectId: string;
  scanId: string;
}

export interface DependencyScanFailedEvent {
  applicationId: string;
  projectId: string;
  scanId: string;
  error: string;
}

const DEPENDENCY_SCAN_COMPLETED = defineEvent<DependencyScanCompletedEvent>({
  key: DEPENDENCY_SCAN_COMPLETED_EVENT,
  name: "Dependency scan completed",
  description: "Emitted after a dependency scan completes successfully and its findings are persisted.",
  payloadExample: {
    applicationId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    scanId: "ckv1a2b3c4d5e6f7g8h9i0j2",
  },
});

const DEPENDENCY_SCAN_FAILED = defineEvent<DependencyScanFailedEvent>({
  key: DEPENDENCY_SCAN_FAILED_EVENT,
  name: "Dependency scan failed",
  description: "Emitted after a dependency scan fails and the failure is persisted.",
  payloadExample: {
    applicationId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    scanId: "ckv1a2b3c4d5e6f7g8h9i0j2",
    error: "GitHub API rate limit exceeded",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const dependencyScanEventDeclarations = [DEPENDENCY_SCAN_COMPLETED, DEPENDENCY_SCAN_FAILED];
