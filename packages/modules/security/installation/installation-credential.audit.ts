/**
 * Audit vocabulary shared by every installation credential lifecycle
 * (ADR-019). The audit module owns the audit storage and its event set is
 * open ("domain.action" strings), so security only declares the names and the
 * minimal recorder shape. Declaring the port here — instead of importing
 * AuditLogService — keeps the dependency direction audit -> security intact
 * and avoids a module cycle.
 */
export const InstallationAuditEvent = {
  ENROLL: "installation.enroll",
  ROTATE: "installation.rotate",
  REVOKE: "installation.revoke",
  RESTORE: "installation.restore",
} as const;

export type InstallationAuditEventType = (typeof InstallationAuditEvent)[keyof typeof InstallationAuditEvent];

/** Parameters accepted by InstallationAuditRecorder.record. */
export interface InstallationAuditParams {
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly actorType?: string;
  readonly actorId?: string | null;
  readonly detail?: Record<string, unknown>;
}

/**
 * Structural subset of audit's AuditLogService.record, so collectors can pass
 * the injected AuditLogService without security depending on the audit module.
 */
export interface InstallationAuditRecorder {
  record(event: string, params: InstallationAuditParams): Promise<void>;
}
