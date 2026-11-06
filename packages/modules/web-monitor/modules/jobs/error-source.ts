/**
 * Error-source classification for the web-monitor threshold alerts (ADR-050).
 *
 * `WebError.api` is the only source of truth for where an error came from; the
 * SDK writes the `ERROR_APIS` values (`console-error`, `onerror`,
 * `unhandled-rejection`, `resource-error`) into it. Both signals build their
 * ClickHouse `api` predicate from the constants below so the grouping, baseline,
 * count and top-items queries cannot drift apart.
 */

/**
 * Runtime sources allowed to open a "new error" alert (`js-error-first-seen`).
 * Console diagnostics and resource-load failures are deliberately absent.
 */
export const FIRST_SEEN_SOURCES: readonly string[] = ["onerror", "unhandled-rejection"];

/**
 * Diagnostic sources excluded from the volume signal (`js-error-spike`).
 * A blacklist, not a whitelist: ajax/fetch rows (empty `api`) and
 * `resource-error` rows must keep counting, otherwise a 5xx burst or a CDN
 * outage would silence the alert.
 */
export const NON_ERROR_SOURCES: readonly string[] = ["console-error"];

function sqlList(values: readonly string[]): string {
  // Values are module constants, never request input, so quoting them here is safe.
  return values.map((value) => `'${value}'`).join(", ");
}

/** `api` predicate of the first-seen signal; grouping and baseline must share it. */
export const FIRST_SEEN_SOURCE_FILTER = `api IN (${sqlList(FIRST_SEEN_SOURCES)})`;

/** `api` predicate of the spike signal; the count and top-items queries must share it. */
export const SPIKE_SOURCE_FILTER = `api NOT IN (${sqlList(NON_ERROR_SOURCES)})`;
