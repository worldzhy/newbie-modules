import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  SECURITY_EVALUATION_KNOWLEDGE_SOURCE_ADAPTERS,
  SecurityEvaluationKnowledgeSourceAdapter,
  SourceKnowledgeItem,
} from "./adapters/source-adapter.port";
import { DEFAULT_MAX_ITEMS_PER_SOURCE, DEFAULT_RETENTION_DAYS } from "./security-evaluation-knowledge.constants";

/** How many upserts run in parallel per batch. */
const UPSERT_BATCH_SIZE = 20;

/**
 * Knowledge collection service for the security-evaluation module (ADR-039).
 *
 * Runs the collection pipeline: fetch from every registered source adapter,
 * then deduplicate and persist by (source, externalId). Ported from the
 * former threat-intelligence module; the item store is now
 * `SecurityEvaluationThreatKnowledgeItem`.
 *
 * Matching against scope entities lives in the INTEL judgment
 * (`judgment/intel/`), not here.
 */
@Injectable()
export class SecurityEvaluationKnowledgeService {
  private readonly logger = new Logger(SecurityEvaluationKnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(SECURITY_EVALUATION_KNOWLEDGE_SOURCE_ADAPTERS)
    private readonly adapters: SecurityEvaluationKnowledgeSourceAdapter[] = [],
  ) {}

  /**
   * Run the collection pipeline: fetch from every registered source adapter,
   * then deduplicate and persist by (source, externalId).
   */
  async collect(since?: Date): Promise<{ collected: number }> {
    const items = await this.fetchAllSources(since);
    if (items.length === 0) {
      this.logger.log("No new knowledge items collected.");
      return { collected: 0 };
    }

    const upserted = await this.upsertItems(items);
    this.logger.log(`Collected ${items.length} items, ${upserted} new/updated.`);
    return { collected: upserted };
  }

  private async fetchAllSources(since?: Date): Promise<SourceKnowledgeItem[]> {
    const all: SourceKnowledgeItem[] = [];
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
  async upsertItems(items: SourceKnowledgeItem[]): Promise<number> {
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

  private async upsertOne(item: SourceKnowledgeItem): Promise<void> {
    const publishedAt =
      item.publishedAt instanceof Date && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : null;
    await this.prisma.securityEvaluationThreatKnowledgeItem.upsert({
      where: { source_externalId: { source: item.source, externalId: item.externalId } },
      update: {
        title: item.title,
        summary: item.summary ?? null,
        url: item.url ?? null,
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
   * This is the ONLY place that deletes knowledge data.
   */
  async pruneExpired(
    retentionDays = DEFAULT_RETENTION_DAYS,
    maxItemsPerSource = DEFAULT_MAX_ITEMS_PER_SOURCE,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deletedByAge = await this.prisma.securityEvaluationThreatKnowledgeItem.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });

    let deletedByCap = 0;
    const sources = await this.prisma.securityEvaluationThreatKnowledgeItem.groupBy({ by: ["source"], _count: true });
    for (const group of sources) {
      if (group._count <= maxItemsPerSource) continue;
      const overflow = group._count - maxItemsPerSource;
      const toDelete = await this.prisma.securityEvaluationThreatKnowledgeItem.findMany({
        where: { source: group.source },
        orderBy: { lastSeenAt: "asc" },
        take: overflow,
        select: { id: true },
      });
      if (toDelete.length > 0) {
        await this.prisma.securityEvaluationThreatKnowledgeItem.deleteMany({
          where: { id: { in: toDelete.map((i) => i.id) } },
        });
        deletedByCap += toDelete.length;
      }
    }

    return { deleted: deletedByAge.count + deletedByCap };
  }
}
