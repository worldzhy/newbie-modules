import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import type {
  SecurityEvaluationIntelNegativeCachePort,
  SecurityEvaluationVerdictKind,
} from "../judgment/intel/security-evaluation-intel-negative-cache.port";

/// Default TTL for not-relevant verdict cache rows. Hosts can override via
/// NEGATIVE_CACHE_TTL_DAYS env; hard-hit rows are NOT subject to this TTL
/// (they are audit traces, not pipeline-skip signals).
const DEFAULT_TTL_DAYS = 7;

/**
 * Prisma adapter for the INTEL verdict cache (ADR-045, R4-04, R4-09).
 *
 * Reads filter to `verdict: "not-relevant"` AND respect TTL — hard-hit rows
 * are intentionally invisible to filterUncached (audit only). The composite
 * unique key `(knowledgeItemId, scopeKey)` makes `record` an upsert, so
 * concurrent scope judgments cannot overwrite each other's rows.
 *
 * This adapter lives outside `judgment/` on purpose: the judgment directory
 * is statically enforced to carry no Prisma dependency.
 */
@Injectable()
export class SecurityEvaluationIntelNegativeCacheRepository implements SecurityEvaluationIntelNegativeCachePort {
  private readonly ttlMs: number;

  constructor(private readonly prisma: PrismaService) {
    const parsed = Number.parseInt(process.env.NEGATIVE_CACHE_TTL_DAYS ?? "", 10);
    const ttlDays = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
    this.ttlMs = ttlDays * 86_400_000;
  }

  async filterUncached(scopeKey: string, knowledgeItemIds: readonly string[]): Promise<string[]> {
    if (knowledgeItemIds.length === 0) return [];

    // Only rows with verdict="not-relevant" AND within TTL filter the pipeline.
    // Hard-hit rows are audit-only and intentionally invisible here — the pair
    // re-enters the pipeline each run because the entity set is dynamic.
    const cutoff = new Date(Date.now() - this.ttlMs);
    const cached = await this.prisma.securityEvaluationThreatVerdictCache.findMany({
      where: {
        scopeKey,
        knowledgeItemId: { in: [...knowledgeItemIds] },
        verdict: "not-relevant",
        updatedAt: { gt: cutoff },
      },
      select: { knowledgeItemId: true },
    });
    const cachedIds = new Set(cached.map((row) => row.knowledgeItemId));
    return knowledgeItemIds.filter((id) => !cachedIds.has(id));
  }

  async record(
    knowledgeItemId: string,
    scopeKey: string,
    verdict: SecurityEvaluationVerdictKind,
    reason?: string | null,
    matchedEntity?: string | null,
  ): Promise<void> {
    // Normalize: undefined → null for the optional payload columns.
    const r = reason ?? null;
    const m = matchedEntity ?? null;

    await this.prisma.securityEvaluationThreatVerdictCache.upsert({
      where: { knowledgeItemId_scopeKey: { knowledgeItemId, scopeKey } },
      create: { knowledgeItemId, scopeKey, verdict, reason: r, matchedEntity: m },
      update: { verdict, reason: r, matchedEntity: m },
    });
  }
}
