import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import type {
  SecurityEvaluationIntelCacheCandidate,
  SecurityEvaluationIntelNegativeCachePort,
  SecurityEvaluationIntelVerdictRecord,
  SecurityEvaluationThreatVerdictKind,
} from "../judgment/intel/security-evaluation-intel-negative-cache.port";

const TTL_DAYS_KEY = "modules.security-evaluation.ttlDays";

/// Validates the TTL days resolved from the assembler's bare env mapping
/// (ADR-033): the value must be a declared positive integer — there is no
/// built-in fallback, so a host that forgets it fails to boot instead of
/// silently expiring on a guessed window. Shared by the module's TTL-gated
/// caches (intel negative cache, code-scan verdict cache).
export function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  return value;
}

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
 * unique key `(knowledgeItemId, scopeKey)` makes `record` an upsert, so
 * concurrent scope judgments cannot overwrite each other's rows.
 *
 * This adapter lives outside `judgment/` on purpose: the judgment directory
 * is statically enforced to carry no Prisma dependency.
 */
@Injectable()
export class SecurityEvaluationIntelNegativeCacheRepository implements SecurityEvaluationIntelNegativeCachePort {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs = requirePositiveInteger(Number(config.getOrThrow<string>(TTL_DAYS_KEY)), TTL_DAYS_KEY) * 86_400_000;
  }

  async filterUncached(
    scopeKey: string,
    candidates: readonly SecurityEvaluationIntelCacheCandidate[],
  ): Promise<string[]> {
    if (candidates.length === 0) return [];

    // Only rows with verdict="not-relevant" AND within TTL filter the pipeline.
    // Hard-hit rows are audit-only and intentionally invisible here — the pair
    // re-enters the pipeline each run because the entity set is dynamic.
    const cutoff = new Date(Date.now() - this.ttlMs);
    const cached = await this.prisma.securityEvaluationThreatVerdictCache.findMany({
      where: {
        scopeKey,
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
    const { knowledgeItemId, scopeKey, verdict, signature } = entry;
    // Normalize: undefined → null for the optional payload columns.
    const reason = entry.reason ?? null;
    const matchedEntity = entry.matchedEntity ?? null;

    const prismaVerdict = PRISMA_VERDICT[verdict];
    await this.prisma.securityEvaluationThreatVerdictCache.upsert({
      where: { knowledgeItemId_scopeKey: { knowledgeItemId, scopeKey } },
      create: { knowledgeItemId, scopeKey, verdict: prismaVerdict, inputSignature: signature, reason, matchedEntity },
      update: { verdict: prismaVerdict, inputSignature: signature, reason, matchedEntity },
    });
  }
}
