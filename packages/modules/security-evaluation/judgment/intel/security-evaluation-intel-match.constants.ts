/**
 * INTEL match enums (module-level contract, ADR-018). They describe
 * how an intel item relates to a matchable scope; the module never names
 * host scope vocabulary (project/application) in these values.
 */

export const SECURITY_EVALUATION_INTEL_MATCH_TYPE = {
  ENTITY: "entity",
  SEMANTIC: "semantic",
} as const;

export type SecurityEvaluationIntelMatchType =
  (typeof SECURITY_EVALUATION_INTEL_MATCH_TYPE)[keyof typeof SECURITY_EVALUATION_INTEL_MATCH_TYPE];

export const SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type SecurityEvaluationIntelMatchConfidence =
  (typeof SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE)[keyof typeof SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE];
