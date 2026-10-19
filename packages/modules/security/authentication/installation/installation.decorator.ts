import { SetMetadata } from "@nestjs/common";

/**
 * Use @InstallationAuth("<kind>") on token-only report endpoints (ADR-016).
 * Implies "skip JWT": the global AuthenticationGuard dispatches to the
 * InstallationAuthGuard, which authenticates the caller via
 * `Authorization: Bearer <installation-token>` (or the collector's
 * documented fallback) against the resolver registered for <kind>.
 */
export const INSTALLATION_AUTH_KEY = "installationAuth";
export const InstallationAuth = (kind: string) => SetMetadata(INSTALLATION_AUTH_KEY, kind);
