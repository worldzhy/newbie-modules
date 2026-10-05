import { SetMetadata } from "@nestjs/core";

/**
 * Marker for routes that emit their own richer business event via
 * AuditLogService.record() for every outcome. The global AuditInterceptor
 * skips the generic http.* row for such routes so a single request does not
 * produce two audit entries.
 *
 * Only apply this when BOTH success and failure paths of the route record
 * explicit events; otherwise failed requests would leave no trail.
 */
export const HTTP_AUDIT_SKIP = "audit:http-skip";

export const SkipHttpAudit = () => SetMetadata(HTTP_AUDIT_SKIP, true);
