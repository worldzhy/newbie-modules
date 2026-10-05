import { SetMetadata } from "@nestjs/common";

/**
 * Declares that a mutating route intentionally produces no business audit
 * event (for example a pure RPC action with no security-relevant state
 * change). The coverage detector skips annotated routes; the reason is
 * shown in code review and future audit coverage reports.
 *
 * Do NOT use this on authentication, authorization, credential, role or
 * sensitive-data routes — those always need explicit events.
 */
export const NO_AUDIT_NEEDED = "audit:no-audit-needed";

export const NoAuditNeeded = (reason: string) => SetMetadata(NO_AUDIT_NEEDED, reason);
