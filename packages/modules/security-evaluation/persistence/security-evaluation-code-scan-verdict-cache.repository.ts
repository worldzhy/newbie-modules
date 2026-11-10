import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  codeScanVerdictCacheKey,
  type SecurityEvaluationCodeScanCachedFinding,
  type SecurityEvaluationCodeScanVerdictCacheEntry,
  type SecurityEvaluationCodeScanVerdictCachePort,
  type SecurityEvaluationCodeScanVerdictLookup,
} from "../judgment/code-scan/security-evaluation-code-scan-verdict-cache.port";
import { requirePositiveInteger } from "./security-evaluation-intel-negative-cache.repository";

const TTL_DAYS_KEY = "modules.security-evaluation.codeScanVerdictCacheTtlDays";

/**
 * Prisma adapter for the CODE_SCAN bipolar verdict cache (ADR-054 clause 6).
 *
 * TTL contract: `modules.security-evaluation.codeScanVerdictCacheTtlDays` is
 * declared per environment (never falls back to a guessed window, ADR-033);
 * rows older than the TTL are misses. Content or version changes already
 * invalidate the key — the TTL only forces a long-unchanged file to be
 * re-judged against model drift.
 */
@Injectable()
export class SecurityEvaluationCodeScanVerdictCacheRepository implements SecurityEvaluationCodeScanVerdictCachePort {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ttlMs = requirePositiveInteger(Number(config.getOrThrow<string>(TTL_DAYS_KEY)), TTL_DAYS_KEY) * 86_400_000;
  }

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
        ruleSetVersion: input.ruleSetVersion,
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
        ruleSetVersion: row.ruleSetVersion,
        // Rows are written from validated finding entries only; the cast is safe.
        findings: row.findings as unknown as SecurityEvaluationCodeScanCachedFinding[],
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
              connectionId,
              promptVersion: entry.promptVersion,
              ruleSetVersion: entry.ruleSetVersion,
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
            ruleSetVersion: entry.ruleSetVersion,
            findings: entry.findings as unknown as never,
            inputSignature: entry.signature,
          },
          update: {
            findings: entry.findings as unknown as never,
            inputSignature: entry.signature,
          },
        });
      }),
    );
  }
}
