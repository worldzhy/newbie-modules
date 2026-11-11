import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SECURITY_EVALUATION_CODE_SCAN_EXCERPT_RETENTION_DAYS } from "../security-evaluation.constants";

export interface SecurityEvaluationCodeScanExcerptInput {
  contentHash: string;
  excerpt: string;
}

/**
 * Storage for the truncated source excerpt a CODE_SCAN run was judged from
 * (ADR-054 D7).
 *
 * The archived result manifest is immutable and must not accumulate source
 * code, so the excerpt is not part of it: a manifest item carries the content
 * hash and the truncated flag, and this table keeps the bytes. Rows are
 * content-addressed by (subject, content hash), so re-scanning unchanged files
 * writes nothing and every run whose manifest carries that hash reads the same
 * excerpt.
 *
 * Retention is physical: `pruneExpired` deletes rows whose last observation is
 * older than the declared window, and `load` applies the same window so a row
 * that outlives a prune cycle is never returned. The finding detail read then
 * falls back to hash + truncated instead of resurrecting the code.
 */
@Injectable()
export class SecurityEvaluationCodeScanExcerptService {
  constructor(private readonly prisma: PrismaService) {}

  async save(subjectId: string, excerpts: readonly SecurityEvaluationCodeScanExcerptInput[]): Promise<void> {
    const rows = dedupeByContentHash(excerpts);
    if (rows.length === 0) return;
    await this.prisma.securityEvaluationCodeScanFileExcerpt.createMany({
      data: rows.map((row) => ({ subjectId, contentHash: row.contentHash, excerpt: row.excerpt })),
      skipDuplicates: true,
    });
    // Refresh the retention clock for content this run has just observed.
    await this.prisma.securityEvaluationCodeScanFileExcerpt.updateMany({
      where: { subjectId, contentHash: { in: rows.map((row) => row.contentHash) } },
      data: { updatedAt: new Date() },
    });
  }

  /** Excerpts still inside the retention window, keyed by content hash. */
  async load(
    subjectId: string,
    contentHashes: readonly string[],
    retentionDays = SECURITY_EVALUATION_CODE_SCAN_EXCERPT_RETENTION_DAYS,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(contentHashes)];
    if (unique.length === 0) return new Map();
    // Retention is enforced on read as well as by the daily prune: a row that
    // outlives the window must not resurface source code between prune runs.
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.securityEvaluationCodeScanFileExcerpt.findMany({
      where: { subjectId, contentHash: { in: unique }, updatedAt: { gte: cutoff } },
      select: { contentHash: true, excerpt: true },
    });
    return new Map(rows.map((row) => [row.contentHash, row.excerpt]));
  }

  /** Single deletion point for retained excerpts. */
  async pruneExpired(
    retentionDays = SECURITY_EVALUATION_CODE_SCAN_EXCERPT_RETENTION_DAYS,
  ): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.securityEvaluationCodeScanFileExcerpt.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
    return { deleted: count };
  }
}

function dedupeByContentHash(
  excerpts: readonly SecurityEvaluationCodeScanExcerptInput[],
): SecurityEvaluationCodeScanExcerptInput[] {
  const byHash = new Map<string, string>();
  for (const excerpt of excerpts) {
    if (!byHash.has(excerpt.contentHash)) byHash.set(excerpt.contentHash, excerpt.excerpt);
  }
  return [...byHash].map(([contentHash, excerpt]) => ({ contentHash, excerpt }));
}
