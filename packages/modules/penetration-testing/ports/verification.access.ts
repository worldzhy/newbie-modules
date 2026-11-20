/**
 * PenetrationVerificationAccess — the host-provided outbound reads used to
 * prove ownership of a web target (ADR-075 §4, ADR-044 §2 shape).
 *
 * The module defines only the two lookups; the host owns the transport and its
 * SSRF guard (public-address checks, redirect policy, timeouts). An unbound
 * port fails the verification call itself, never the module boot.
 */
export const PENETRATION_TESTING_VERIFICATION_ACCESS = "PENETRATION_TESTING_VERIFICATION_ACCESS";

export interface PenetrationVerificationAccess {
  /** TXT records of a DNS name; an empty array when the name has none. */
  lookupTxt(name: string): Promise<string[]>;
  /** Body of a text URL; the host enforces the public-address/HTTPS guard. */
  fetchText(url: string): Promise<string>;
}
