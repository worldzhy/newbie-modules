import { defineEvent } from "@modules/event-emitter/event-definition";
import type { ThreatIntelligenceMatchConfidence } from "./matching/threat-intelligence-match.constants";

/** Emitted only for a genuinely newly created match; re-evaluations stay silent. */
export const THREAT_INTELLIGENCE_MATCH_CREATED_EVENT = "threat-intelligence.match-created";

export interface ThreatIntelligenceMatchCreatedEvent {
  matchId: string;
  scopeType: string;
  scopeId: string;
  itemId: string;
  confidence: ThreatIntelligenceMatchConfidence;
}

const THREAT_INTELLIGENCE_MATCH_CREATED = defineEvent<ThreatIntelligenceMatchCreatedEvent>({
  key: THREAT_INTELLIGENCE_MATCH_CREATED_EVENT,
  name: "Threat intelligence match created",
  description: "Emitted only for a genuinely newly created match; re-evaluating an existing match stays silent.",
  payloadExample: {
    matchId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    scopeType: "repository",
    scopeId: "ckv1a2b3c4d5e6f7g8h9i0j2",
    itemId: "ckv1a2b3c4d5e6f7g8h9i0j3",
    confidence: "high",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const threatIntelligenceEventDeclarations = [THREAT_INTELLIGENCE_MATCH_CREATED];
