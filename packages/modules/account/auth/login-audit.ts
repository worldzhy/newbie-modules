import type { Request } from "express";
import { AuditActorType, AuditEvent, AuditLogService, AuditResult } from "@modules/audit/audit-log.service";

/**
 * Parameters for a failed-login audit row. 'actorId' is null when the
 * rejection happens before an identity is established (for example an
 * unknown account or an unverifiable MFA challenge token).
 *
 * Pass 'request' from an auth strategy to copy IP and User-Agent, or pass
 * 'ipAddress'/'userAgent' directly when the caller only has extracted
 * strings.
 */
export type RecordLoginFailureParams = {
  actorId: string | null;
  detail: Record<string, unknown>;
  request?: Request;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Record a failed login attempt. Every authentication strategy must call
 * this on rejection: auth guards run before the global audit interceptor,
 * so a rejected request would otherwise leave no trail.
 */
export async function recordLoginFailure(
  auditLogService: AuditLogService,
  params: RecordLoginFailureParams,
): Promise<void> {
  await auditLogService.record(AuditEvent.LOGIN_FAILED, {
    actorType: params.actorId ? AuditActorType.USER : undefined,
    actorId: params.actorId,
    result: AuditResult.FAILURE,
    ipAddress: params.request?.ip ?? params.ipAddress,
    userAgent: params.request?.headers["user-agent"] ?? params.userAgent,
    detail: params.detail,
  });
}
