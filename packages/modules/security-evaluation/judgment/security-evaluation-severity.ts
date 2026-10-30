/** Severity values accepted by the evaluation skeleton (ADR-020 D2). */
export type SecurityEvaluationFindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Where a severity value came from; "unknown" means the record carried none. */
export type SecurityEvaluationSeveritySource = "database_specific" | "unknown";

export interface OsvSeverityMapping {
  severity: SecurityEvaluationFindingSeverity;
  source: SecurityEvaluationSeveritySource;
}

/**
 * Map the severity string of an OSV record to the skeleton vocabulary.
 *
 * OSV records carry severity only as free text (`database_specific.severity`),
 * with "moderate" in some ecosystems where others say "medium"; CVSS vectors in
 * `severity[]` are not interpreted. A record without recognisable severity is
 * reported as INFO with source "unknown" rather than guessed upward.
 */
export function mapOsvSeverity(raw: unknown): OsvSeverityMapping {
  if (typeof raw !== "string") return { severity: "INFO", source: "unknown" };
  switch (raw.trim().toLowerCase()) {
    case "critical":
      return { severity: "CRITICAL", source: "database_specific" };
    case "high":
      return { severity: "HIGH", source: "database_specific" };
    case "moderate":
    case "medium":
      return { severity: "MEDIUM", source: "database_specific" };
    case "low":
      return { severity: "LOW", source: "database_specific" };
    case "info":
    case "informational":
    case "none":
      return { severity: "INFO", source: "database_specific" };
    default:
      return { severity: "INFO", source: "unknown" };
  }
}
