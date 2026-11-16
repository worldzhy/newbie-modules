import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SECURITY_EVALUATION_INTEL_NEGATIVE_CACHE_TTL_DAYS } from "../security-evaluation.constants";
import type {
  SecurityEvaluationIntelCacheCandidate,
  SecurityEvaluationIntelNegativeCachePort,
  SecurityEvaluationIntelVerdictRecord,
  SecurityEvaluationThreatVerdictKind,
} from "../judgment/intel/security-evaluation-intel-negative-cache.port";

/**
 * Prisma enum values must be identifiers, so the schema keeps the domain
 * vocabulary (`not-relevant` / `hard-hit`) as `@map`ped database values.
 * Translate at this adapter boundary only.
 */
const PRISMA_VERDICT: Record<SecurityEvaluationThreatVerdictKind, "notRelevant" | "hardHit"> = {
  "not-relevant": "notRelevant",
  "hard-hit": "hardHit",
};

/**
 * Prisma adapter for the INTEL verdict cache (ADR-045, R4-04, R4-09).
 *
 * Reads filter to `verdict: "not-relevant"` AND respect TTL — hard-hit rows
 * are intentionally invisible to filterUncached (audit only). The composite
 * unique key `(knowledgeItemId, subjectKind, subjectKey)` makes `record` an
 * upsert, so concurrent scope judgments cannot overwrite each other's rows.
 *
 * This adapter lives outside `judgment/` on purpose: the judgment directory
 * is statically enforced to carry no Prisma dependency.
 */
@Injectable()
export class SecurityEvaluationIntelNegativeCacheRepository implements SecurityEvaluationIntelNegativeCachePort {
  private readonly ttlMs = SECURITY_EVALUATION_INTEL_NEGATIVE_CACHE_TTL_DAYS * 86_400_000;

  constructor(private readonly prisma: PrismaService) {}

  async filterUncached(
    subjectKind: string,
    subjectKey: string,
    candidates: readonly SecurityEvaluationIntelCacheCandidate[],
  ): Promise<string[]> {
    if (candidates.length === 0) return [];

    // Only rows with verdict="not-relevant" AND within TTL filter the pipeline.
    // Hard-hit rows are audit-only and intentionally invisible here — the pair
    // re-enters the pipeline each run because the entity set is dynamic.
    const cutoff = new Date(Date.now() - this.ttlMs);
    const cached = await this.prisma.securityEvaluationThreatVerdictCache.findMany({
      where: {
        subjectKind,
        subjectKey,
        knowledgeItemId: { in: candidates.map((candidate) => candidate.knowledgeItemId) },
        verdict: PRISMA_VERDICT["not-relevant"],
        updatedAt: { gt: cutoff },
      },
      select: { knowledgeItemId: true, inputSignature: true },
    });
    // A row recorded under a different signature describes a different
    // judgment input, so it is a miss. Rows written before signatures existed
    // carry null and are misses too.
    const signatureById = new Map(cached.map((row) => [row.knowledgeItemId, row.inputSignature]));
    return candidates
      .filter((candidate) => signatureById.get(candidate.knowledgeItemId) !== candidate.signature)
      .map((candidate) => candidate.knowledgeItemId);
  }

  async record(entry: SecurityEvaluationIntelVerdictRecord): Promise<void> {
    const { knowledgeItemId, subjectKind, subjectKey, verdict, signature } = entry;
    // Normalize: undefined → null for the optional payload columns.
    const reason = entry.reason ?? null;
    const matchedEntity = entry.matchedEntity ?? null;

    const prismaVerdict = PRISMA_VERDICT[verdict];
    await this.prisma.securityEvaluationThreatVerdictCache.upsert({
      where: { knowledgeItemId_subjectKind_subjectKey: { knowledgeItemId, subjectKind, subjectKey } },
      create: {
        knowledgeItemId,
        subjectKind,
        subjectKey,
        verdict: prismaVerdict,
        inputSignature: signature,
        reason,
        matchedEntity,
      },
      update: { verdict: prismaVerdict, inputSignature: signature, reason, matchedEntity },
    });
  }
}
