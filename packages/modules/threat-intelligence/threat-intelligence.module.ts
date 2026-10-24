import { Global, Module } from "@nestjs/common";
import { ThreatIntelligenceController } from "./threat-intelligence.controller";
import { ThreatIntelligenceService } from "./threat-intelligence.service";
import { THREAT_INTELLIGENCE_SOURCE_ADAPTERS } from "./adapters/source-adapter.port";
import { AwsSecurityBulletinsAdapter } from "./adapters/aws-security-bulletins.adapter";
import { BleepingComputerAdapter } from "./adapters/bleeping-computer.adapter";
import { CisaKevAdapter } from "./adapters/cisa-kev.adapter";
import { FreeBufAdapter } from "./adapters/freebuf.adapter";
import { GitHubSecurityAdvisoryAdapter } from "./adapters/github-security-advisory.adapter";
import { GitHubSecurityBlogAdapter } from "./adapters/github-security-blog.adapter";
import { TheHackerNewsAdapter } from "./adapters/the-hacker-news.adapter";

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
 * Adapters are gathered into an array via a factory provider and injected
 * on the THREAT_INTELLIGENCE_SOURCE_ADAPTERS token. Adding a new source =
 * implement ThreatIntelligenceSourceAdapter, register it as a provider, and
 * add it to the factory inject list below.
 */
@Global()
@Module({
  controllers: [ThreatIntelligenceController],
  providers: [
    ThreatIntelligenceService,
    GitHubSecurityAdvisoryAdapter,
    CisaKevAdapter,
    AwsSecurityBulletinsAdapter,
    GitHubSecurityBlogAdapter,
    FreeBufAdapter,
    TheHackerNewsAdapter,
    BleepingComputerAdapter,
    {
      provide: THREAT_INTELLIGENCE_SOURCE_ADAPTERS,
      useFactory: (
        ghsa: GitHubSecurityAdvisoryAdapter,
        cisa: CisaKevAdapter,
        aws: AwsSecurityBulletinsAdapter,
        ghblog: GitHubSecurityBlogAdapter,
        freebuf: FreeBufAdapter,
        thn: TheHackerNewsAdapter,
        bleeping: BleepingComputerAdapter,
      ) => [ghsa, cisa, aws, ghblog, freebuf, thn, bleeping],
      inject: [
        GitHubSecurityAdvisoryAdapter,
        CisaKevAdapter,
        AwsSecurityBulletinsAdapter,
        GitHubSecurityBlogAdapter,
        FreeBufAdapter,
        TheHackerNewsAdapter,
        BleepingComputerAdapter,
      ],
    },
  ],
  exports: [ThreatIntelligenceService],
})
export class ThreatIntelligenceModule {}
