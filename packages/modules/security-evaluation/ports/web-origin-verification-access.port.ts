/**
 * VerificationFetchAccess — the host-provided outbound reads used to prove
 * ownership of a web origin (ADR-044 §2).
 *
 * The module defines only the two lookups; the host owns the transport and its
 * SSRF guard (public-address checks, redirect policy, timeouts). A deployment
 * that never registers a web origin simply does not bind the token — the port
 * is injected optionally and only fails the verification call itself.
 */
export const securityEvaluationVerificationFetchAccessToken = "SECURITY_EVALUATION_VERIFICATION_FETCH_ACCESS";

export interface VerificationFetchAccess {
  /** TXT records of a DNS name; an empty array when the name has none. */
  lookupTxt(name: string): Promise<string[]>;
  /** Body of a text URL; the host enforces the public-address/HTTPS guard. */
  fetchText(url: string): Promise<string>;
}
