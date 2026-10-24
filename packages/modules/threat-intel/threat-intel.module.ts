import { Global, Module } from "@nestjs/common";
import { ThreatIntelController } from "./threat-intel.controller";
import { ThreatIntelService } from "./threat-intel.service";
import { MatchReRanker } from "./llm/match-re-ranker";

/**
 * External threat intelligence module (ADR-031).
 *
 * Collects intel from registered source adapters, deduplicates by
 * (source, externalId), matches against project security profiles
 * (hard entity recall + LLM structured re-rank), and records matches.
 *
 * Source adapters and the project security profile port are provided by
 * the host via multi-binding; this registry module ships the collection
 * and matching pipeline only.
 */
@Global()
@Module({
  controllers: [ThreatIntelController],
  providers: [ThreatIntelService, MatchReRanker],
  exports: [ThreatIntelService],
})
export class ThreatIntelModule {}
