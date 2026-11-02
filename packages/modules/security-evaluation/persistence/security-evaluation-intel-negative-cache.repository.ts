import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import type { SecurityEvaluationIntelNegativeCachePort } from "../judgment/intel/security-evaluation-intel-negative-cache.port";

/**
 * Prisma adapter for the INTEL negative cache (ADR-045).
 *
 * The composite unique key `(knowledgeItemId, scopeKey)` makes `record` an
 * upsert, so concurrent scope judgments cannot overwrite each other's rows.
 * This adapter lives outside `judgment/` on purpose: the judgment directory
 * is statically enforced to carry no Prisma dependency.
 */
@Injectable()
export class SecurityEvaluationIntelNegativeCacheRepository implements SecurityEvaluationIntelNegativeCachePort {
  constructor(private readonly prisma: PrismaService) {}

  async filterUncached(scopeKey: string, knowledgeItemIds: readonly string[]): Promise<string[]> {
    if (knowledgeItemIds.length === 0) return [];

    const cached = await this.prisma.securityEvaluationThreatNegativeCache.findMany({
      where: { scopeKey, knowledgeItemId: { in: [...knowledgeItemIds] } },
      select: { knowledgeItemId: true },
    });
    const cachedIds = new Set(cached.map((row) => row.knowledgeItemId));
    return knowledgeItemIds.filter((id) => !cachedIds.has(id));
  }

  async record(knowledgeItemId: string, scopeKey: string, reason: string): Promise<void> {
    await this.prisma.securityEvaluationThreatNegativeCache.upsert({
      where: { knowledgeItemId_scopeKey: { knowledgeItemId, scopeKey } },
      create: { knowledgeItemId, scopeKey, reason },
      update: { reason },
    });
  }
}
