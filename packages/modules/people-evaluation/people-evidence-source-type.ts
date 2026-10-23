/**
 * Shared evidence source type union.
 *
 * Declared once here so both the collector layer and the scoring layer
 * import the same symbol — no more "must match" comments in two places
 * drifting apart. Aligns with Prisma EvidenceSourceType enum in
 * prisma/schema.prisma (same values, kept as a separate union because
 * the registry package does not build the Prisma client).
 */
export type EvidenceSourceType = "GIT" | "INCIDENT" | "TEST_TREND" | "WORK_DELIVERABLE";
