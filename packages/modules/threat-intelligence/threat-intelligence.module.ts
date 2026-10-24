import { Global, Module } from "@nestjs/common";
import { ThreatIntelligenceController } from "./threat-intelligence.controller";
import { ThreatIntelligenceService } from "./threat-intelligence.service";
import { SOURCE_ADAPTER } from "./adapters/source-adapter.port";
import { AwsSecurityBulletinsAdapter } from "./adapters/aws-security-bulletins.adapter";
import { CisaKevAdapter } from "./adapters/cisa-kev.adapter";
import { FreeBufAdapter } from "./adapters/freebuf.adapter";
import { GitHubSecurityAdvisoryAdapter } from "./adapters/github-security-advisory.adapter";
import { GitHubSecurityBlogAdapter } from "./adapters/github-security-blog.adapter";

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
 *
 * Adapters are multi-bound on the SOURCE_ADAPTER token so the service can
 * iterate over all of them. Adding a new source = implement SourceAdapter
 * and add one provider entry below.
 */
@Global()
@Module({
  controllers: [ThreatIntelligenceController],
  providers: [
    ThreatIntelligenceService,
    { provide: SOURCE_ADAPTER, useClass: GitHubSecurityAdvisoryAdapter },
    { provide: SOURCE_ADAPTER, useClass: CisaKevAdapter },
    { provide: SOURCE_ADAPTER, useClass: AwsSecurityBulletinsAdapter },
    { provide: SOURCE_ADAPTER, useClass: GitHubSecurityBlogAdapter },
    { provide: SOURCE_ADAPTER, useClass: FreeBufAdapter },
  ],
  exports: [ThreatIntelligenceService],
})
export class ThreatIntelligenceModule {}
