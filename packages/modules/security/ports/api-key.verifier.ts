/**
 * SPI port for API key credential verification. The security module only
 * owns the HTTP transport (headers + passport strategy); storage and secret
 * comparison belong to the identity provider (e.g. account).
 */

export const API_KEY_VERIFIER = Symbol("API_KEY_VERIFIER");

export interface ApiKeyVerifier {
  /**
   * Returns true only when the key exists and the presented secret matches
   * the stored credential. Implementations MUST throw UnauthorizedException
   * (not return false) for unknown key or mismatched secret.
   */
  verify(key: string, secret: string): Promise<boolean>;
}
