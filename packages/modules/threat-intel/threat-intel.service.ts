import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { SourceAdapter, SourceIntelItem, SOURCE_ADAPTER } from "./adapters/source-adapter.port";
import { DEFAULT_MAX_ITEMS_PER_SOURCE, DEFAULT_RETENTION_DAYS } from "./threat-intel.constants";
import { ListThreatIntelItemsQuery } from "./threat-intel.dto";

@Injectable()
export class ThreatIntelService {
  private readonly logger = new Logger(ThreatIntelService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(SOURCE_ADAPTER) private readonly adapters: SourceAdapter[] = [],
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
    const item = await this.prisma.threatIntelItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Threat intel item ${id} not found.`);
    return item;
  }
}
