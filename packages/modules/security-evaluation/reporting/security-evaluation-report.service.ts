import { Injectable } from "@nestjs/common";
import { EvaluationFindingStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationScope } from "@modules/evaluation/ports/evaluation.contracts";

import {
  SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS,
  SECURITY_EVALUATION_REPORT_TREND_WEEKS,
  SECURITY_EVALUATION_SUBJECT_KINDS,
} from "../security-evaluation.constants";
import { deriveUrgencyRank, type SecurityEvaluationUrgency } from "../judgment/security-evaluation-urgency";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_OPEN_LIMIT = 20;
/** Bounded page size for reading OPEN findings whose urgency is JSON metadata. */
const FINDING_SUMMARY_PAGE_SIZE = 500;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
const URGENCIES: readonly SecurityEvaluationUrgency[] = ["P1", "P2", "P3", "P4"];

/** Ranked top-open ordering: highest urgency first, then oldest finding, then id for stability. */
function compareTopOpen(
  left: { urgency: SecurityEvaluationUrgency; firstSeenAt: Date; id: string },
  right: { urgency: SecurityEvaluationUrgency; firstSeenAt: Date; id: string },
): number {
  return (
    deriveUrgencyRank(right.urgency) - deriveUrgencyRank(left.urgency) ||
    left.firstSeenAt.getTime() - right.firstSeenAt.getTime() ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/** The coverage buckets an archived result carries, per evaluation axis. */
type CoverageStatsSummary = {
  evaluated?: { total?: number };
  declaredUnlinked?: { total?: number };
  skipped?: { total?: number };
  unconsumed?: { total?: number };
};

export interface SecurityEvaluationReport {
  generatedAt: Date;
  assets: {
    total: number;
    stale: number;
    lastObservedAt: Date | null;
  };
  coverage: {
    evaluated: number;
    declaredUnlinked: number;
    skipped: number;
    unconsumed: number;
    assetsWithResult: number;
  };
  findings: {
    open: number;
    bySeverity: Record<(typeof SEVERITIES)[number], number>;
    byUrgency: Record<SecurityEvaluationUrgency, number>;
    topOpen: {
      id: string;
      subjectId: string;
      title: string;
      severity: string;
      urgency: SecurityEvaluationUrgency;
      firstSeenAt: Date;
    }[];
  };
  trend: { weekStart: Date; opened: number; resolved: number }[];
  mttr: { averageDays: number | null; resolvedCount: number; windowDays: number };
}

/**
 * SecurityEvaluationReportService — the read model of the first slice
 * (ADR-022 D6): assets, coverage, findings, trend and MTTR. Coverage reflects
 * the latest result per subject per evaluation axis (ADR-020 D5.2). There is no
 * composite score and no cross-evaluationKey weighting.
 */
@Injectable()
export class SecurityEvaluationReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(scope: EvaluationScope): Promise<SecurityEvaluationReport> {
    const subjects = await this.prisma.evaluationSubject.findMany({
      where: {
        kind: { in: [...SECURITY_EVALUATION_SUBJECT_KINDS] },
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
      },
      select: { id: true },
    });
    const subjectIds = subjects.map((subject) => subject.id);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS * DAY_MS);

    const assets = await this.prisma.securityEvaluationAsset.findMany({
      where: { subjectId: { in: subjectIds } },
      select: { lastSeenAt: true },
    });
    const lastObservedAt = assets.reduce<Date | null>(
      (latest, asset) => (latest === null || asset.lastSeenAt > latest ? asset.lastSeenAt : latest),
      null,
    );

    const latestResults = await this.latestResultsBySubject(subjectIds);
    const coverage = {
      evaluated: 0,
      declaredUnlinked: 0,
      skipped: 0,
      unconsumed: 0,
      assetsWithResult: latestResults.size,
    };
    for (const byAxis of latestResults.values()) {
      for (const stats of byAxis.values()) {
        coverage.evaluated += stats.evaluated?.total ?? 0;
        coverage.declaredUnlinked += stats.declaredUnlinked?.total ?? 0;
        coverage.skipped += stats.skipped?.total ?? 0;
        coverage.unconsumed += stats.unconsumed?.total ?? 0;
      }
    }

    const findings = await this.findingSummary(subjectIds);
    const windowDays = SECURITY_EVALUATION_REPORT_TREND_WEEKS * 7;
    const since = new Date(now.getTime() - windowDays * DAY_MS);

    return {
      generatedAt: now,
      assets: {
        total: assets.length,
        stale: assets.filter((asset) => asset.lastSeenAt < staleBefore).length,
        lastObservedAt,
      },
      coverage,
      findings,
      trend: await this.trend(subjectIds, since),
      mttr: await this.mttr(subjectIds, since, windowDays),
    };
  }

  private async latestResultsBySubject(subjectIds: readonly string[]) {
    const latest = new Map<string, Map<string, CoverageStatsSummary>>();
    if (subjectIds.length === 0) return latest;
    const results = await this.prisma.evaluationResult.findMany({
      where: { subjectId: { in: [...subjectIds] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        subjectId: true,
        coverageStats: true,
        ruleSetVersion: { select: { evaluationKey: true } },
      },
    });
    for (const result of results) {
      const byAxis = latest.get(result.subjectId) ?? new Map<string, CoverageStatsSummary>();
      const evaluationKey = result.ruleSetVersion.evaluationKey;
      if (byAxis.has(evaluationKey)) continue;
      byAxis.set(evaluationKey, (result.coverageStats ?? {}) as CoverageStatsSummary);
      latest.set(result.subjectId, byAxis);
    }
    return latest;
  }

  private async findingSummary(subjectIds: readonly string[]) {
    const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
      (typeof SEVERITIES)[number],
      number
    >;
    const byUrgency = Object.fromEntries(URGENCIES.map((urgency) => [urgency, 0])) as Record<
      SecurityEvaluationUrgency,
      number
    >;
    if (subjectIds.length === 0) {
      return { open: 0, bySeverity, byUrgency, topOpen: [] };
    }

    const grouped = await this.prisma.evaluationFinding.groupBy({
      by: ["severity", "status"],
      where: { subjectId: { in: [...subjectIds] }, status: EvaluationFindingStatus.OPEN },
      _count: { _all: true },
    });
    let open = 0;
    for (const row of grouped) {
      open += row._count._all;
      if (row.severity in bySeverity) bySeverity[row.severity as (typeof SEVERITIES)[number]] += row._count._all;
    }

    // Urgency lives in the JSON metadata column, so it cannot be aggregated by
    // Prisma. Iterate the OPEN findings in bounded pages and keep only the
    // ranked top-N in memory instead of loading every row at once.
    const topOpen: Array<{
      id: string;
      subjectId: string;
      title: string;
      severity: string;
      urgency: SecurityEvaluationUrgency;
      firstSeenAt: Date;
    }> = [];
    let cursor: { id: string } | undefined;
    for (;;) {
      const batch = await this.prisma.evaluationFinding.findMany({
        where: { subjectId: { in: [...subjectIds] }, status: EvaluationFindingStatus.OPEN },
        select: { id: true, subjectId: true, title: true, severity: true, metadata: true, firstSeenAt: true },
        orderBy: { id: "asc" },
        take: FINDING_SUMMARY_PAGE_SIZE,
        ...(cursor ? { cursor, skip: 1 } : {}),
      });
      for (const finding of batch) {
        const urgency = readUrgency(finding.metadata);
        byUrgency[urgency] += 1;
        topOpen.push({
          id: finding.id,
          subjectId: finding.subjectId,
          title: finding.title,
          severity: finding.severity,
          urgency,
          firstSeenAt: finding.firstSeenAt,
        });
      }
      topOpen.sort(compareTopOpen);
      topOpen.length = Math.min(topOpen.length, TOP_OPEN_LIMIT);
      if (batch.length < FINDING_SUMMARY_PAGE_SIZE) break;
      cursor = { id: batch[batch.length - 1].id };
    }

    return { open, bySeverity, byUrgency, topOpen };
  }

  private async trend(subjectIds: readonly string[], since: Date) {
    if (subjectIds.length === 0) return [];
    const opened = await this.prisma.$queryRaw<{ weekStart: Date; count: number }[]>`
      SELECT date_trunc('week', "firstSeenAt") AS "weekStart", count(*)::int AS "count"
      FROM "module/evaluation"."EvaluationFinding"
      WHERE "subjectId" IN (${Prisma.join([...subjectIds])}) AND "firstSeenAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `;
    const resolved = await this.prisma.$queryRaw<{ weekStart: Date; count: number }[]>`
      SELECT date_trunc('week', "resolvedAt") AS "weekStart", count(*)::int AS "count"
      FROM "module/evaluation"."EvaluationFinding"
      WHERE "subjectId" IN (${Prisma.join([...subjectIds])}) AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `;
    const weeks = new Map<string, { weekStart: Date; opened: number; resolved: number }>();
    for (const row of opened) {
      const key = row.weekStart.toISOString();
      weeks.set(key, { weekStart: row.weekStart, opened: row.count, resolved: 0 });
    }
    for (const row of resolved) {
      const key = row.weekStart.toISOString();
      const existing = weeks.get(key);
      if (existing) existing.resolved = row.count;
      else weeks.set(key, { weekStart: row.weekStart, opened: 0, resolved: row.count });
    }
    return [...weeks.values()].sort((left, right) => left.weekStart.getTime() - right.weekStart.getTime());
  }

  private async mttr(subjectIds: readonly string[], since: Date, windowDays: number) {
    if (subjectIds.length === 0) return { averageDays: null, resolvedCount: 0, windowDays };
    const rows = await this.prisma.$queryRaw<{ averageDays: number | null; resolvedCount: number }[]>`
      SELECT
        avg(extract(epoch from ("resolvedAt" - "firstSeenAt")) / 86400.0)::float8 AS "averageDays",
        count(*)::int AS "resolvedCount"
      FROM "module/evaluation"."EvaluationFinding"
      WHERE "subjectId" IN (${Prisma.join([...subjectIds])}) AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= ${since}
    `;
    const row = rows[0];
    return {
      averageDays: row?.averageDays ?? null,
      resolvedCount: row?.resolvedCount ?? 0,
      windowDays,
    };
  }
}

function readUrgency(metadata: Prisma.JsonValue | null): SecurityEvaluationUrgency {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "P4";
  const value = metadata.urgency;
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" ? value : "P4";
}
