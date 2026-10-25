import { Global, Module } from "@nestjs/common";
import { ThreatIntelligenceController } from "./threat-intelligence.controller";
import { ThreatIntelligenceService } from "./threat-intelligence.service";
import { ThreatIntelligenceMatchController } from "./matching/threat-intelligence-match.controller";
import { ThreatIntelligenceMatchService } from "./matching/threat-intelligence-match.service";
import { ThreatIntelligenceReRanker } from "./matching/threat-intelligence-re-ranker";
import { THREAT_INTELLIGENCE_SOURCE_ADAPTERS } from "./adapters/source-adapter.port";
import { AwsSecurityBulletinsAdapter } from "./adapters/aws-security-bulletins.adapter";
import { BleepingComputerAdapter } from "./adapters/bleeping-computer.adapter";
import { CisaKevAdapter } from "./adapters/cisa-kev.adapter";
import { FreeBufAdapter } from "./adapters/freebuf.adapter";
import { GitHubSecurityAdvisoryAdapter } from "./adapters/github-security-advisory.adapter";
import { GitHubSecurityBlogAdapter } from "./adapters/github-security-blog.adapter";
import { TheHackerNewsAdapter } from "./adapters/the-hacker-news.adapter";

/**
 * External threat intelligence module (ADR-018).
 *
 * Delivers the full collect + organize capability: source adapters gather
 * intel, items are deduplicated by (source, externalId), and the matching
 * pipeline (hard entity recall + LLM structured re-rank, B3 protocol)
 * relates items to matchable scopes via the host-bound
 * ScopeEntitiesProvider port (matching/scope-entities.port.ts).
 *
 * The module never names host scope concepts: matches store generic
 * (scopeType, scopeId) coordinates without foreign keys. Notification
 * templates, digests, and scheduling remain host concerns — the module only
 * emits "threat-intelligence.match-created" domain events.
 *
 * Adapters are gathered into an array via a factory provider and injected
 * on the THREAT_INTELLIGENCE_SOURCE_ADAPTERS token. Adding a new source =
 * implement ThreatIntelligenceSourceAdapter, register it as a provider, and
 * add it to the factory inject list below.
 */
@Global()
@Module({
  controllers: [ThreatIntelligenceController, ThreatIntelligenceMatchController],
  providers: [
    ThreatIntelligenceService,
    ThreatIntelligenceMatchService,
    ThreatIntelligenceReRanker,
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
  exports: [ThreatIntelligenceService, ThreatIntelligenceMatchService],
})
export class ThreatIntelligenceModule {}
