/**
 * Threat intel match enums (module-level contract, ADR-018). They describe
 * how an intel item relates to a matchable scope; the module never names
 * host scope vocabulary (project/application) in these values.
 */

export const THREAT_INTELLIGENCE_MATCH_TYPE = {
  ENTITY: "entity",
  SEMANTIC: "semantic",
} as const;

export type ThreatIntelligenceMatchType =
  (typeof THREAT_INTELLIGENCE_MATCH_TYPE)[keyof typeof THREAT_INTELLIGENCE_MATCH_TYPE];

export const THREAT_INTELLIGENCE_MATCH_STATUS = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  FALSE_POSITIVE: "false-positive",
} as const;

export type ThreatIntelligenceMatchStatus =
  (typeof THREAT_INTELLIGENCE_MATCH_STATUS)[keyof typeof THREAT_INTELLIGENCE_MATCH_STATUS];

export const THREAT_INTELLIGENCE_MATCH_CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type ThreatIntelligenceMatchConfidence =
  (typeof THREAT_INTELLIGENCE_MATCH_CONFIDENCE)[keyof typeof THREAT_INTELLIGENCE_MATCH_CONFIDENCE];
