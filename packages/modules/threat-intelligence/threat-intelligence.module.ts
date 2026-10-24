import { Global, Module } from "@nestjs/common";
import { ThreatIntelligenceController } from "./threat-intelligence.controller";
import { ThreatIntelligenceService } from "./threat-intelligence.service";

/**
 * External threat intelligence module (ADR-031).
 *
 * Platform-level collection layer: gathers intel from registered source
 * adapters, deduplicates by (source, externalId), stores it, and exposes
 * read APIs plus the retention cleanup.
 *
 * This module knows nothing about projects. Whether and how a host matches
 * items against its projects is a host concern (nightwatch-backend keeps
 * that layer in src/application/project/security).
 */
@Global()
@Module({
  controllers: [ThreatIntelligenceController],
  providers: [ThreatIntelligenceService],
  exports: [ThreatIntelligenceService],
})
export class ThreatIntelligenceModule {}
