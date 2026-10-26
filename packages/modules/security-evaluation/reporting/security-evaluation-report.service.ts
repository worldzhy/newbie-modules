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
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
const URGENCIES: readonly SecurityEvaluationUrgency[] = ["P1", "P2", "P3", "P4"];

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
 * SecurityEvaluationReportService — the single-axis read model of the first
 * slice (ADR-022 D6): assets, coverage, findings, trend and MTTR. There is no
 * composite score and no cross-evaluationKey weighting; adding a second axis is a
 * later milestone, not a field to sneak in here.
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
      assetsWithResult: latestResults.size,
    };
    for (const stats of latestResults.values()) {
      coverage.evaluated += stats.evaluated?.total ?? 0;
      coverage.declaredUnlinked += stats.declaredUnlinked?.total ?? 0;
      coverage.skipped += stats.skipped?.total ?? 0;
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
    const latest = new Map<
      string,
      { evaluated?: { total?: number }; declaredUnlinked?: { total?: number }; skipped?: { total?: number } }
    >();
    if (subjectIds.length === 0) return latest;
    const results = await this.prisma.evaluationResult.findMany({
      where: { subjectId: { in: [...subjectIds] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { subjectId: true, coverageStats: true },
    });
    for (const result of results) {
      if (latest.has(result.subjectId)) continue;
      latest.set(result.subjectId, (result.coverageStats ?? {}) as Record<string, { total?: number }>);
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

    const openFindings = await this.prisma.evaluationFinding.findMany({
      where: { subjectId: { in: [...subjectIds] }, status: EvaluationFindingStatus.OPEN },
      select: { id: true, subjectId: true, title: true, severity: true, metadata: true, firstSeenAt: true },
      orderBy: [{ severity: "desc" }, { firstSeenAt: "asc" }],
    });
    for (const finding of openFindings) {
      const urgency = readUrgency(finding.metadata);
      byUrgency[urgency] += 1;
    }
    const topOpen = [...openFindings]
      .sort(
        (left, right) =>
          deriveUrgencyRank(readUrgency(right.metadata)) - deriveUrgencyRank(readUrgency(left.metadata)) ||
          left.firstSeenAt.getTime() - right.firstSeenAt.getTime(),
      )
      .slice(0, TOP_OPEN_LIMIT)
      .map((finding) => ({
        id: finding.id,
        subjectId: finding.subjectId,
        title: finding.title,
        severity: finding.severity,
        urgency: readUrgency(finding.metadata),
        firstSeenAt: finding.firstSeenAt,
      }));

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
