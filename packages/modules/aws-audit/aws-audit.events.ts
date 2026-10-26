import { defineEvent } from "@modules/event-emitter/event-definition";

/** Emitted after a scan completes successfully and its findings are persisted. */
export const AWS_AUDIT_SCAN_COMPLETED_EVENT = "aws-audit.scan-completed";

/** Emitted after a scan fails and the failure is persisted. */
export const AWS_AUDIT_SCAN_FAILED_EVENT = "aws-audit.scan-failed";

export interface AwsAuditScanCompletedEvent {
  projectId: string;
  scanId: string;
}

export interface AwsAuditScanFailedEvent {
  projectId: string;
  scanId: string;
  error: string;
}

const AWS_AUDIT_SCAN_COMPLETED = defineEvent<AwsAuditScanCompletedEvent>({
  key: AWS_AUDIT_SCAN_COMPLETED_EVENT,
  name: "AWS audit scan completed",
  description: "Emitted after an audit scan completes successfully and its findings are persisted.",
  payloadExample: {
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    scanId: "ckv1a2b3c4d5e6f7g8h9i0j1",
  },
});

const AWS_AUDIT_SCAN_FAILED = defineEvent<AwsAuditScanFailedEvent>({
  key: AWS_AUDIT_SCAN_FAILED_EVENT,
  name: "AWS audit scan failed",
  description: "Emitted after an audit scan fails and the failure is persisted.",
  payloadExample: {
    projectId: "8f02d95a-b027-4f7d-bc37-3749d2739b34",
    scanId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    error: "AccessDenied: not authorized to perform iam:ListUsers",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const awsAuditEventDeclarations = [AWS_AUDIT_SCAN_COMPLETED, AWS_AUDIT_SCAN_FAILED];
