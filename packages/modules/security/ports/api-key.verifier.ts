/**
 * SPI port for API key credential verification. The security module only
 * owns the HTTP transport (headers + passport strategy); storage and secret
 * comparison belong to the identity provider (e.g. account).
 */

export const API_KEY_VERIFIER = Symbol("API_KEY_VERIFIER");

/**
 * Transport facts a verifier needs to enforce per-key restrictions. Populated
 * from the HTTP request by the strategy; the provider never reaches into the
 * request itself.
 */
export interface ApiKeyRequestContext {
  /** Client address as resolved by the HTTP layer (Express `req.ip`). */
  ipAddress?: string;
  /** `Origin` header, present on cross-origin browser calls. */
  origin?: string;
  /** `Referer` header, used as the fallback for same-origin navigations. */
  referrer?: string;
}

export interface ApiKeyVerifier {
  /**
   * Returns true only when the key exists, the presented secret matches the
   * stored credential, and the request satisfies the key's network
   * restrictions. Implementations MUST throw UnauthorizedException (not return
   * false) for unknown key, mismatched secret, or a blocked request.
   */
  verify(key: string, secret: string, context?: ApiKeyRequestContext): Promise<boolean>;
}
