/**
 * WebProbeAccess — the host-provided, read-only observer of a web origin
 * (ADR-066 §3).
 *
 * The module states only the observation shapes and the request budget; it
 * never performs network I/O, holds a URL allowlist or resolves DNS. The host
 * owns SSRF checks, timeouts, concurrency, User-Agent, redirect policy and
 * egress control (ADR-044 §3).
 *
 * HTTP and TLS observation share one port on purpose: they depend on the same
 * egress policy and budget, and splitting them would leave room for a
 * half-bound adapter that silently degrades. A host that does not bind the port
 * cannot run web-origin evaluations at all: the run fails with a wiring error
 * rather than reporting a vacuous clean result (ADR-022).
 */
export const SECURITY_EVALUATION_WEB_PROBE_ACCESS = "SECURITY_EVALUATION_WEB_PROBE_ACCESS";

/** One HTTP observation request: the origin plus the semantic role being probed. */
export interface WebHttpObserveRequest {
  /** Normalized origin (`scheme://host[:port]`) to probe. */
  origin: string;
  /** Path role from the asset's target map, e.g. "html" or "api.session". */
  role: string;
  /** Relative path resolved from the role by the caller. */
  path: string;
}

/**
 * One HTTP observation. A request that never completed throws: a transport
 * failure is not evidence, and treating it as an empty response would invent
 * missing-header findings that nobody observed.
 */
export interface WebHttpObservation {
  /** Role the request was made for. */
  role: string;
  requestedUrl: string;
  /** Final URL after the host's redirect policy was applied. */
  finalUrl: string;
  status: number;
  /** Response headers with lowercase names; repeated headers are joined by the host. */
  headers: Record<string, string>;
  /** Redirect hops in order, so evidence keeps every hop that was followed. */
  redirects: string[];
}

/** TLS handshake observation of the origin. */
export interface WebTlsObservation {
  protocols: { tls10: boolean; tls11: boolean; tls12: boolean; tls13: boolean };
  cipherSuites: Array<{ protocol: string; name: string }>;
}

export interface WebProbeAccess {
  observeHttp(request: WebHttpObserveRequest): Promise<WebHttpObservation>;
  observeTls(origin: string): Promise<WebTlsObservation>;
}
