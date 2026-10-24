import { Global, Module } from "@nestjs/common";
import { ThreatIntelController } from "./threat-intel.controller";
import { ThreatIntelService } from "./threat-intel.service";

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
  controllers: [ThreatIntelController],
  providers: [ThreatIntelService],
  exports: [ThreatIntelService],
})
export class ThreatIntelModule {}
