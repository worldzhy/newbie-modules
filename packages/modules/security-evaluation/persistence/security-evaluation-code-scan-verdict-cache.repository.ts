import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS } from "../security-evaluation.constants";
import {
  codeScanVerdictCacheKey,
  type SecurityEvaluationCodeScanCachedFinding,
  type SecurityEvaluationCodeScanVerdictCacheEntry,
  type SecurityEvaluationCodeScanVerdictCachePort,
  type SecurityEvaluationCodeScanVerdictLookup,
} from "../judgment/code-scan/security-evaluation-code-scan-verdict-cache.port";

/**
 * Prisma adapter for the CODE_SCAN bipolar verdict cache (ADR-054 clause 6).
 *
 * TTL contract: `SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS` is a
 * module constant (ADR-053: identical in every deployment, so it follows the
 * code version); rows older than the TTL are misses. Content or version
 * changes already invalidate the key — the TTL only forces a long-unchanged
 * file to be re-judged against model drift.
 */
@Injectable()
export class SecurityEvaluationCodeScanVerdictCacheRepository implements SecurityEvaluationCodeScanVerdictCachePort {
  private readonly ttlMs = SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS * 86_400_000;

  constructor(private readonly prisma: PrismaService) {}

  async lookup(
    input: SecurityEvaluationCodeScanVerdictLookup,
  ): Promise<Map<string, SecurityEvaluationCodeScanVerdictCacheEntry[]>> {
    if (input.files.length === 0) return new Map();
    const cutoff = new Date(Date.now() - this.ttlMs);
    const connectionId = input.connectionId ?? null;
    const rows = await this.prisma.securityEvaluationCodeScanVerdictCache.findMany({
      where: {
        subjectId: input.subjectId,
        modelId: input.modelId,
        connectionId,
        promptVersion: input.promptVersion,
        ruleSetVersionLabel: input.ruleSetVersionLabel,
        path: { in: input.files.map((file) => file.path) },
        updatedAt: { gt: cutoff },
      },
    });

    const wanted = new Set(input.files.map((file) => codeScanVerdictCacheKey(file.path, file.contentHash)));
    const grouped = new Map<string, SecurityEvaluationCodeScanVerdictCacheEntry[]>();
    for (const row of rows) {
      const key = codeScanVerdictCacheKey(row.path, row.contentHash);
      if (!wanted.has(key)) continue;
      const entry: SecurityEvaluationCodeScanVerdictCacheEntry = {
        subjectId: row.subjectId,
        criterionKey: row.criterionKey,
        path: row.path,
        contentHash: row.contentHash,
        modelId: row.modelId,
        connectionId: row.connectionId,
        promptVersion: row.promptVersion,
        ruleSetVersionLabel: row.ruleSetVersionLabel,
        // Rows are written from validated finding entries only; the cast is safe.
        cachedFindings: row.cachedFindings as unknown as SecurityEvaluationCodeScanCachedFinding[],
        signature: row.inputSignature ?? "",
      };
      const bucket = grouped.get(key);
      if (bucket) bucket.push(entry);
      else grouped.set(key, [entry]);
    }
    return grouped;
  }

  async record(entries: readonly SecurityEvaluationCodeScanVerdictCacheEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.$transaction(
      entries.map((entry) => {
        const connectionId = entry.connectionId ?? null;
        return this.prisma.securityEvaluationCodeScanVerdictCache.upsert({
          where: {
            codeScanVerdictIdentity: {
              subjectId: entry.subjectId,
              criterionKey: entry.criterionKey,
              path: entry.path,
              contentHash: entry.contentHash,
              modelId: entry.modelId,
              connectionId: connectionId as string,
              promptVersion: entry.promptVersion,
              ruleSetVersionLabel: entry.ruleSetVersionLabel,
            },
          },
          create: {
            subjectId: entry.subjectId,
            criterionKey: entry.criterionKey,
            path: entry.path,
            contentHash: entry.contentHash,
            modelId: entry.modelId,
            connectionId,
            promptVersion: entry.promptVersion,
            ruleSetVersionLabel: entry.ruleSetVersionLabel,
            cachedFindings: entry.cachedFindings as unknown as never,
            inputSignature: entry.signature,
          },
          update: {
            cachedFindings: entry.cachedFindings as unknown as never,
            inputSignature: entry.signature,
          },
        });
      }),
    );
  }

  /**
   * Single deletion point for expired rows. A row past the TTL is a miss on
   * read, so keeping it only grows the table: the TTL is enforced physically
   * here rather than being a read-side filter over an unbounded store.
   */
  async pruneExpired(): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - this.ttlMs);
    const { count } = await this.prisma.securityEvaluationCodeScanVerdictCache.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
    return { deleted: count };
  }
}
