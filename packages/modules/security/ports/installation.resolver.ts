/**
 * SPI port for installation credential resolution (ADR-016). The security
 * module only owns the HTTP transport (Bearer header, legacy private header
 * during the migration window, or a body field for the web-monitor sendBeacon
 * exception); token hashing, storage and revocation checks belong to the
 * collector that owns the installation table.
 *
 * NestJS 12 removed multi-providers, so each collector binds its resolver
 * under a kind-scoped injection token (its module re-exports the binding into
 * the global container) and the InstallationAuthGuard resolves it via
 * ModuleRef.
 */
export const installationResolverToken = (kind: string): string => `INSTALLATION_RESOLVER:${kind}`;

export interface InstallationResolver {
  /** Collector module key this resolver authenticates, e.g. "heartbeat". */
  readonly kind: string;
  /**
   * Legacy private header accepted during the SDK migration window,
   * e.g. "x-heartbeat-token". Removed once all SDKs present Bearer tokens.
   */
  readonly legacyHeader?: string;
  /**
   * Body field carrying the token for endpoints whose browser SDK posts via
   * navigator.sendBeacon, which cannot set custom headers (web-monitor only).
   */
  readonly bodyTokenField?: string;
  /**
   * Returns the installation context for a valid, non-revoked token; the
   * shape is collector-defined and is attached to the request as
   * `req.installation`. Implementations MUST throw UnauthorizedException
   * (not return null) for unknown or revoked tokens.
   */
  resolve(token: string, kind: string): Promise<unknown>;
}
