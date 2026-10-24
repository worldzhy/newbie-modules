import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { SourceAdapter, SourceIntelItem, SOURCE_ADAPTER } from "./adapters/source-adapter.port";
import { MatchReRanker } from "./llm/match-re-ranker";
import {
  PROJECT_SECURITY_PROFILE_PORT,
  ProjectSecurityProfile,
  ProjectSecurityProfilePort,
} from "./project-security-profile.port";
import {
  DEFAULT_MAX_ITEMS_PER_SOURCE,
  DEFAULT_RETENTION_DAYS,
  THREAT_INTEL_CONFIDENCE,
  THREAT_INTEL_MATCH_STATUS,
  THREAT_INTEL_MATCH_TYPE,
  ThreatIntelSeverity,
} from "./threat-intel.constants";
import { ListThreatIntelItemsQuery, ListThreatIntelMatchesQuery } from "./threat-intel.dto";

const SEVERITY_RANK: Record<ThreatIntelSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Items below this severity never go through the LLM re-ranker. */
const RE_RANK_MIN_SEVERITY: ThreatIntelSeverity = "medium";

@Injectable()
export class ThreatIntelService {
  private readonly logger = new Logger(ThreatIntelService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SOURCE_ADAPTER) private readonly adapters: SourceAdapter[],
    private readonly reRanker: MatchReRanker,
    @Inject(PROJECT_SECURITY_PROFILE_PORT) private readonly profilePort: ProjectSecurityProfilePort,
  ) {}

  /**
   * Run the full collection + matching pipeline. Called by the daily
   * scheduled job and the manual trigger endpoint.
   */
  async collectAndMatch(since?: Date): Promise<{ collected: number; matched: number }> {
    const items = await this.fetchAllSources(since);
    if (items.length === 0) {
      this.logger.log("No new threat intel items collected.");
      return { collected: 0, matched: 0 };
    }

    const upserted = await this.upsertItems(items);
    this.logger.log(`Collected ${items.length} items, ${upserted} new/updated.`);

    const profiles = await this.profilePort.listProfiles();
    if (profiles.length === 0) {
      this.logger.warn("No project security profiles available; skipping matching.");
      return { collected: upserted, matched: 0 };
    }

    let matchedCount = 0;
    // Re-fetch the persisted items (with ids) for matching.
    const persisted = await this.prisma.threatIntelItem.findMany({
      where: { source: { in: items.map((i) => i.source) } },
      orderBy: { fetchedAt: "desc" },
      take: items.length,
    });

    for (const item of persisted) {
      const created = await this.matchItem(item, profiles);
      matchedCount += created;
    }

    return { collected: upserted, matched: matchedCount };
  }

  private async fetchAllSources(since?: Date): Promise<SourceIntelItem[]> {
    const all: SourceIntelItem[] = [];
    for (const adapter of this.adapters) {
      try {
        const items = await adapter.fetchLatest(since);
        all.push(...items);
      } catch (error) {
        this.logger.error(
          `Source adapter ${adapter.source} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return all;
  }

  /**
   * Upsert items by (source, externalId). Returns the count of rows
   * touched (new + updated).
   */
  async upsertItems(items: SourceIntelItem[]): Promise<number> {
    let touched = 0;
    for (const item of items) {
      await this.prisma.threatIntelItem.upsert({
        where: { source_externalId: { source: item.source, externalId: item.externalId } },
        update: {
          title: item.title,
          summary: item.summary ?? null,
          url: item.url ?? null,
          publishedAt: item.publishedAt ?? null,
          severity: item.severity,
          signalTags: item.signalTags,
          rawPayload: item.rawPayload as Prisma.InputJsonValue,
          lastSeenAt: new Date(),
        },
        create: {
          source: item.source,
          category: item.category,
          externalId: item.externalId,
          title: item.title,
          summary: item.summary ?? null,
          url: item.url ?? null,
          publishedAt: item.publishedAt ?? null,
          severity: item.severity,
          signalTags: item.signalTags,
          rawPayload: item.rawPayload as Prisma.InputJsonValue,
        },
      });
      touched += 1;
    }
    return touched;
  }

  /**
   * Match one item against all project profiles.
   *
   * Stage 1 (hard recall): exact entity substring match against title +
   * summary. Stage 2 (LLM re-rank): only for items that had no hard hit
   * AND meet the severity/signal threshold, to control token cost.
   *
   * Returns the number of new matches created.
   */
  private async matchItem(
    item: { id: string; title: string; summary: string | null; severity: string; signalTags: string[] },
    profiles: ProjectSecurityProfile[],
  ): Promise<number> {
    const haystack = `${item.title}\n${item.summary ?? ""}`.toLowerCase();
    let created = 0;

    for (const profile of profiles) {
      if (profile.entities.length === 0) {
        continue;
      }

      const hardHits = profile.entities.filter((e) => haystack.includes(e.value.toLowerCase()));
      if (hardHits.length > 0) {
        await this.createMatch({
          itemId: item.id,
          projectId: profile.projectId,
          applicationId: profile.applicationId,
          matchType: THREAT_INTEL_MATCH_TYPE.ENTITY,
          matchedEntity: hardHits[0].value,
          evidence: hardHits.map((h) => h.value).join(", "),
          confidence: THREAT_INTEL_CONFIDENCE.HIGH,
        });
        created += 1;
        continue;
      }

      // Stage 2: LLM re-rank only for sufficiently severe items.
      if (this.shouldReRank(item.severity as ThreatIntelSeverity, item.signalTags)) {
        const verdict = await this.reRanker.reRank(
          { title: item.title, summary: item.summary ?? undefined },
          profile.entities,
        );
        if (verdict.finalRelevant) {
          const matched = verdict.entityMatches.find((m) => m.matched);
          await this.createMatch({
            itemId: item.id,
            projectId: profile.projectId,
            applicationId: profile.applicationId,
            matchType: THREAT_INTEL_MATCH_TYPE.SEMANTIC,
            matchedEntity: matched?.entity ?? null,
            evidence: verdict.reason,
            confidence: THREAT_INTEL_CONFIDENCE.MEDIUM,
          });
          created += 1;
        }
      }
    }

    return created;
  }

  private shouldReRank(severity: ThreatIntelSeverity, signalTags: string[]): boolean {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[RE_RANK_MIN_SEVERITY] || signalTags.length > 0;
  }

  private async createMatch(data: {
    itemId: string;
    projectId: string;
    applicationId?: string;
    matchType: string;
    matchedEntity: string | null;
    evidence: string | null;
    confidence: string;
  }): Promise<void> {
    // Avoid duplicate matches for the same (item, project, entity).
    await this.prisma.threatIntelMatch.upsert({
      where: {
        itemId_projectId_matchedEntity: {
          itemId: data.itemId,
          projectId: data.projectId,
          matchedEntity: data.matchedEntity ?? "",
        },
      },
      update: {
        matchType: data.matchType,
        evidence: data.evidence,
        confidence: data.confidence,
        status: THREAT_INTEL_MATCH_STATUS.OPEN,
      },
      create: {
        itemId: data.itemId,
        projectId: data.projectId,
        applicationId: data.applicationId ?? null,
        matchType: data.matchType,
        matchedEntity: data.matchedEntity,
        evidence: data.evidence,
        confidence: data.confidence,
        status: THREAT_INTEL_MATCH_STATUS.OPEN,
      },
    });
  }

  /**
   * Single retention cleanup point. Prunes items older than
   * `retentionDays` and enforces `maxItemsPerSource` per source.
   * This is the ONLY place that deletes threat intel data.
   */
  async pruneExpired(
    retentionDays = DEFAULT_RETENTION_DAYS,
    maxItemsPerSource = DEFAULT_MAX_ITEMS_PER_SOURCE,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deletedByAge = await this.prisma.threatIntelItem.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });

    let deletedByCap = 0;
    const sources = await this.prisma.threatIntelItem.groupBy({ by: ["source"], _count: true });
    for (const group of sources) {
      if (group._count <= maxItemsPerSource) continue;
      const overflow = group._count - maxItemsPerSource;
      const toDelete = await this.prisma.threatIntelItem.findMany({
        where: { source: group.source },
        orderBy: { lastSeenAt: "asc" },
        take: overflow,
        select: { id: true },
      });
      if (toDelete.length > 0) {
        await this.prisma.threatIntelItem.deleteMany({ where: { id: { in: toDelete.map((i) => i.id) } } });
        deletedByCap += toDelete.length;
      }
    }

    return { deleted: deletedByAge.count + deletedByCap };
  }

  // ----- Read API -----

  async listItems(query: ListThreatIntelItemsQuery) {
    const where: Prisma.ThreatIntelItemWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.severity) where.severity = query.severity;
    if (query.source) where.source = query.source;
    if (query.matchedOnly) where.matches = { some: {} };

    const [items, total] = await Promise.all([
      this.prisma.threatIntelItem.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
      }),
      this.prisma.threatIntelItem.count({ where }),
    ]);
    return { items, total };
  }

  async getItem(id: string) {
    const item = await this.prisma.threatIntelItem.findUnique({
      where: { id },
      include: { matches: true },
    });
    if (!item) throw new NotFoundException(`Threat intel item ${id} not found.`);
    return item;
  }

  async listMatches(query: ListThreatIntelMatchesQuery) {
    const where: Prisma.ThreatIntelMatchWhereInput = {};
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.confidence) where.confidence = query.confidence;

    const [matches, total] = await Promise.all([
      this.prisma.threatIntelMatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
        include: { item: true },
      }),
      this.prisma.threatIntelMatch.count({ where }),
    ]);
    return { matches, total };
  }

  async updateMatchStatus(id: string, status: string) {
    const match = await this.prisma.threatIntelMatch.findUnique({ where: { id } });
    if (!match) throw new NotFoundException(`Threat intel match ${id} not found.`);
    return this.prisma.threatIntelMatch.update({
      where: { id },
      data: { status, resolvedAt: status === THREAT_INTEL_MATCH_STATUS.RESOLVED ? new Date() : null },
    });
  }
}
