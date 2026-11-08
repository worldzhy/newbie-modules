/**
 * ClickHouse DateTime64 literal formatter.
 *
 * ClickHouse parses DateTime64 from the ISO-8601 extended form with a space
 * separator and no timezone suffix (`YYYY-MM-DD HH:mm:ss.sss`). The value is
 * always UTC — `Date.toISOString()` already produces UTC, we only strip the
 * `T` separator and trailing `Z` so the literal matches the ingest writer's
 * format.
 */
export function toClickHouseDateTime(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
