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
 * Adapters are gathered into an array via a factory provider and injected
 * on the SOURCE_ADAPTER token. Adding a new source = implement SourceAdapter,
 * register it as a provider, and add it to the factory inject list below.
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
    {
      provide: SOURCE_ADAPTER,
      useFactory: (
        ghsa: GitHubSecurityAdvisoryAdapter,
        cisa: CisaKevAdapter,
        aws: AwsSecurityBulletinsAdapter,
        ghblog: GitHubSecurityBlogAdapter,
        freebuf: FreeBufAdapter,
      ) => [ghsa, cisa, aws, ghblog, freebuf],
      inject: [
        GitHubSecurityAdvisoryAdapter,
        CisaKevAdapter,
        AwsSecurityBulletinsAdapter,
        GitHubSecurityBlogAdapter,
        FreeBufAdapter,
      ],
    },
  ],
  exports: [ThreatIntelligenceService],
})
export class ThreatIntelligenceModule {}
