import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  SourceIntelItem,
  ThreatIntelligenceSourceAdapter,
  THREAT_INTELLIGENCE_SOURCE_ADAPTERS,
} from "./adapters/source-adapter.port";
import { DEFAULT_MAX_ITEMS_PER_SOURCE, DEFAULT_RETENTION_DAYS } from "./threat-intelligence.constants";
import { ListThreatIntelligenceItemsQuery } from "./threat-intelligence.dto";

/** Fields returned by read APIs; rawPayload stays internal to the store. */
const ITEM_SELECT = {
  id: true,
  source: true,
  category: true,
  externalId: true,
  title: true,
  summary: true,
  url: true,
  publishedAt: true,
  severity: true,
  signalTags: true,
  fetchedAt: true,
  lastSeenAt: true,
} satisfies Prisma.ThreatIntelligenceItemSelect;

/** How many upserts run in parallel per batch. */
const UPSERT_BATCH_SIZE = 20;

@Injectable()
export class ThreatIntelligenceService {
  private readonly logger = new Logger(ThreatIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(THREAT_INTELLIGENCE_SOURCE_ADAPTERS)
    private readonly adapters: ThreatIntelligenceSourceAdapter[] = [],
  ) {}

  /**
   * Run the collection pipeline: fetch from every registered source adapter,
   * then deduplicate and persist by (source, externalId). Called by the daily
   * scheduled job and the manual trigger endpoint.
   *
   * Matching against projects is a host concern and intentionally lives
   * outside this module.
   */
  async collect(since?: Date): Promise<{ collected: number }> {
    const items = await this.fetchAllSources(since);
    if (items.length === 0) {
      this.logger.log("No new threat intel items collected.");
      return { collected: 0 };
    }

    const upserted = await this.upsertItems(items);
    this.logger.log(`Collected ${items.length} items, ${upserted} new/updated.`);
    return { collected: upserted };
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
   * touched (new + updated). Runs in small concurrent batches; a single
   * malformed row is logged and skipped instead of aborting the run.
   */
  async upsertItems(items: SourceIntelItem[]): Promise<number> {
    let touched = 0;
    for (let i = 0; i < items.length; i += UPSERT_BATCH_SIZE) {
      const batch = items.slice(i, i + UPSERT_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map((item) => this.upsertOne(item)));
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          touched += 1;
        } else {
          this.logger.warn(
            `Skipping item ${batch[index].source}/${batch[index].externalId}: ${
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            }`,
          );
        }
      }
    }
    return touched;
  }

  private async upsertOne(item: SourceIntelItem): Promise<void> {
    // Feeds occasionally carry unparsable dates; an Invalid Date would make
    // Prisma throw, so fall back to null instead of poisoning the batch.
    const publishedAt =
      item.publishedAt instanceof Date && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : null;
    await this.prisma.threatIntelligenceItem.upsert({
      where: { source_externalId: { source: item.source, externalId: item.externalId } },
      update: {
        title: item.title,
        summary: item.summary ?? null,
        url: item.url ?? null,
        // On update, a transient parse failure must not erase a previously
        // stored publishedAt — only overwrite when the new value is valid.
        ...(publishedAt ? { publishedAt } : {}),
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
        publishedAt,
        severity: item.severity,
        signalTags: item.signalTags,
        rawPayload: item.rawPayload as Prisma.InputJsonValue,
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
    const deletedByAge = await this.prisma.threatIntelligenceItem.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });

    let deletedByCap = 0;
    const sources = await this.prisma.threatIntelligenceItem.groupBy({ by: ["source"], _count: true });
    for (const group of sources) {
      if (group._count <= maxItemsPerSource) continue;
      const overflow = group._count - maxItemsPerSource;
      const toDelete = await this.prisma.threatIntelligenceItem.findMany({
        where: { source: group.source },
        orderBy: { lastSeenAt: "asc" },
        take: overflow,
        select: { id: true },
      });
      if (toDelete.length > 0) {
        await this.prisma.threatIntelligenceItem.deleteMany({ where: { id: { in: toDelete.map((i) => i.id) } } });
        deletedByCap += toDelete.length;
      }
    }

    return { deleted: deletedByAge.count + deletedByCap };
  }

  // ----- Read API -----

  async listItems(query: ListThreatIntelligenceItemsQuery) {
    const where: Prisma.ThreatIntelligenceItemWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.severity) where.severity = query.severity;
    if (query.source) where.source = query.source;

    const [items, total] = await Promise.all([
      this.prisma.threatIntelligenceItem.findMany({
        where,
        // publishedAt is nullable and many items share the same second (KEV
        // dateAdded, same-day news); id keeps offset pagination stable.
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
        select: ITEM_SELECT,
      }),
      this.prisma.threatIntelligenceItem.count({ where }),
    ]);
    return { items, total };
  }

  async getItem(id: string) {
    const item = await this.prisma.threatIntelligenceItem.findUnique({ where: { id }, select: ITEM_SELECT });
    if (!item) throw new NotFoundException(`Threat intel item ${id} not found.`);
    return item;
  }
}
