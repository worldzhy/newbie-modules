import { SetMetadata } from "@nestjs/common";

/**
 * Use @PublicCors() on token-only report endpoints that browsers on any
 * origin must reach (ADR-016). The route is recorded in a metadata-driven
 * registry at startup; the Express-level hook in main.ts reads that registry
 * to answer CORS `*` (including OPTIONS preflight, which never reaches the
 * Nest pipeline). Replaces the old substring-matched openApiRoutes list.
 */
export const PUBLIC_CORS_KEY = "publicCors";
export const PublicCors = () => SetMetadata(PUBLIC_CORS_KEY, true);
