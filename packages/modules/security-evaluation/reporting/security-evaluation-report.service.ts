import { Injectable } from "@nestjs/common";
import { EvaluationFindingStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS,
  SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS,
  SECURITY_EVALUATION_REPORT_TREND_WEEKS,
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KINDS,
} from "../security-evaluation.constants";
import { deriveUrgencyRank, type SecurityEvaluationUrgency } from "../judgment/security-evaluation-urgency";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_OPEN_LIMIT = 20;
/** Bounded page size for reading OPEN findings whose urgency is JSON metadata. */
const FINDING_SUMMARY_PAGE_SIZE = 500;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;
type Severity = (typeof SEVERITIES)[number];
const URGENCIES: readonly SecurityEvaluationUrgency[] = ["P1", "P2", "P3", "P4"];

/** A zeroed severity bucket, so a missing severity still renders as 0. */
function emptySeverityCounts(): Record<Severity, number> {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
}

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
    /**
     * Assets that cannot be evaluated at all right now: their subject kind
     * requires a registered credential reference and none is stored. Surfaced
     * as its own bucket so an un-integrated subject never reads as coverage.
     */
    unevaluable: number;
  };
  findings: {
    open: number;
    bySeverity: Record<Severity, number>;
    byUrgency: Record<SecurityEvaluationUrgency, number>;
    byEvaluationKey: {
      evaluationKey: string;
      open: number;
      bySeverity: Record<Severity, number>;
    }[];
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
  /**
   * Findings still open at the end of each day of the window, split by
   * severity. Reconstructed from firstSeenAt/resolvedAt so a day keeps the
   * count it had at the time.
   */
  severityTrend: {
    windowDays: number;
    points: { day: Date; bySeverity: Record<Severity, number>; total: number }[];
  };
  mttr: {
    averageDays: number | null;
    resolvedCount: number;
    windowDays: number;
    byEvaluationKey: {
      evaluationKey: string;
      averageDays: number | null;
      medianDays: number | null;
      resolvedCount: number;
    }[];
  };
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

  /**
   * Build the platform report, or a provenance-filtered slice when `subjectIds`
   * is given (ADR-039): `null` means the whole platform, an empty array means
   * the filter matched nothing.
   *
   * `severityTrendDays` sizes the daily severity series; the weekly
   * opened/resolved trend and the MTTR window stay fixed.
   */
  async getReport(
    subjectIdsFilter: readonly string[] | null,
    severityTrendDays = SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS,
  ): Promise<SecurityEvaluationReport> {
    const subjects = await this.prisma.evaluationSubject.findMany({
      where: subjectIdsFilter
        ? { id: { in: [...subjectIdsFilter] } }
        : { kind: { in: [...SECURITY_EVALUATION_SUBJECT_KINDS] } },
      select: { id: true, kind: true, credentialRef: true },
    });
    const subjectIds = subjects.map((subject) => subject.id);
    // The aws-account kind is evaluated through a host credential registered
    // at ingest; a subject without the pointer is unevaluable until the host
    // re-submits it with one.
    //
    // `unevaluable` means strictly "never bound at ingest". A *dangling*
    // reference (pointer present, target credential since deleted) is not
    // counted here: collection resolves the pointer at run time, fails to find
    // the credential, and accounts the subject in that run's skipped bucket
    // (SE-CRED-03).
    const unevaluable = subjects.filter(
      (subject) => subject.kind === SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT && !subject.credentialRef,
    ).length;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS * DAY_MS);

    // Aggregate in the database instead of loading every asset row: the report
    // only needs total/stale counts plus the latest observation time
    // (R5-P2-06).
    const [assetTotal, assetStale, assetLatest] = await Promise.all([
      this.prisma.securityEvaluationAsset.count({ where: { subjectId: { in: subjectIds } } }),
      this.prisma.securityEvaluationAsset.count({
        where: { subjectId: { in: subjectIds }, lastSeenAt: { lt: staleBefore } },
      }),
      this.prisma.securityEvaluationAsset.aggregate({
        where: { subjectId: { in: subjectIds } },
        _max: { lastSeenAt: true },
      }),
    ]);
    const lastObservedAt = assetLatest._max.lastSeenAt;

    const latestResults = await this.latestResultsBySubject(subjectIds);
    const coverage = {
      evaluated: 0,
      declaredUnlinked: 0,
      skipped: 0,
      unconsumed: 0,
      assetsWithResult: latestResults.size,
      unevaluable,
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
        total: assetTotal,
        stale: assetStale,
        lastObservedAt,
      },
      coverage,
      findings,
      trend: await this.trend(subjectIds, since),
      severityTrend: await this.severityTrend(subjectIds, severityTrendDays, now),
      mttr: await this.mttr(subjectIds, since, windowDays),
    };
  }

  private async latestResultsBySubject(subjectIds: readonly string[]) {
    const latest = new Map<string, Map<string, CoverageStatsSummary>>();
    if (subjectIds.length === 0) return latest;
    const results = await this.prisma.evaluationResult.findMany({
      where: { subjectId: { in: [...subjectIds] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      // Only the newest result per subject×rule-set is needed; distinct keeps
      // the response bounded by subjects×evaluation keys instead of history
      // depth (R5-P2-06).
      distinct: ["subjectId", "ruleSetVersionId"],
      select: {
        subjectId: true,
        ruleSetVersionId: true,
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
    const bySeverity = emptySeverityCounts();
    const byUrgency = Object.fromEntries(URGENCIES.map((urgency) => [urgency, 0])) as Record<
      SecurityEvaluationUrgency,
      number
    >;
    const byKey = new Map<string, { evaluationKey: string; open: number; bySeverity: Record<Severity, number> }>();
    if (subjectIds.length === 0) {
      return { open: 0, bySeverity, byUrgency, byEvaluationKey: [], topOpen: [] };
    }

    // One pass over the OPEN set yields the platform severity split and the
    // per-evaluationKey split: the grouped rows are already keyed by both.
    const grouped = await this.prisma.evaluationFinding.groupBy({
      by: ["evaluationKey", "severity"],
      where: { subjectId: { in: [...subjectIds] }, status: EvaluationFindingStatus.OPEN },
      _count: { _all: true },
    });
    let open = 0;
    for (const row of grouped) {
      const count = row._count._all;
      open += count;
      const severity = row.severity as Severity;
      if (severity in bySeverity) bySeverity[severity] += count;
      const keyEntry = byKey.get(row.evaluationKey) ?? {
        evaluationKey: row.evaluationKey,
        open: 0,
        bySeverity: emptySeverityCounts(),
      };
      keyEntry.open += count;
      if (severity in keyEntry.bySeverity) keyEntry.bySeverity[severity] += count;
      byKey.set(row.evaluationKey, keyEntry);
    }
    const byEvaluationKey = [...byKey.values()].sort((left, right) =>
      left.evaluationKey.localeCompare(right.evaluationKey),
    );

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

    return { open, bySeverity, byUrgency, byEvaluationKey, topOpen };
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

  /**
   * Findings still open at the end of each day in the window, split by
   * severity. A finding counts on a day when it had already been first seen and
   * was not yet resolved at that day's end; suppressed findings are excluded
   * because a suppression carries no timestamp to place on the timeline.
   */
  private async severityTrend(subjectIds: readonly string[], days: number, now: Date) {
    if (subjectIds.length === 0) return { windowDays: days, points: [] };
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; critical: number; high: number; medium: number; low: number; info: number }>
    >`
      WITH window AS (
        SELECT generate_series(
          date_trunc('day', ${now}::timestamptz) - (${days}::int - 1) * interval '1 day',
          date_trunc('day', ${now}::timestamptz),
          interval '1 day'
        ) AS day
      )
      SELECT
        w.day AS "day",
        (count(f."id") FILTER (WHERE f."severity" = 'CRITICAL'))::int AS "critical",
        (count(f."id") FILTER (WHERE f."severity" = 'HIGH'))::int AS "high",
        (count(f."id") FILTER (WHERE f."severity" = 'MEDIUM'))::int AS "medium",
        (count(f."id") FILTER (WHERE f."severity" = 'LOW'))::int AS "low",
        (count(f."id") FILTER (WHERE f."severity" = 'INFO'))::int AS "info"
      FROM window w
      LEFT JOIN "module/evaluation"."EvaluationFinding" f
        ON f."subjectId" IN (${Prisma.join([...subjectIds])})
       AND f."status" <> 'SUPPRESSED'
       AND f."firstSeenAt" < w.day + interval '1 day'
       AND (f."resolvedAt" IS NULL OR f."resolvedAt" >= w.day + interval '1 day')
      GROUP BY w.day
      ORDER BY w.day
    `;
    return {
      windowDays: days,
      points: rows.map((row) => {
        const bySeverity: Record<Severity, number> = {
          CRITICAL: row.critical,
          HIGH: row.high,
          MEDIUM: row.medium,
          LOW: row.low,
          INFO: row.info,
        };
        return {
          day: row.day,
          bySeverity,
          total: row.critical + row.high + row.medium + row.low + row.info,
        };
      }),
    };
  }

  private async mttr(subjectIds: readonly string[], since: Date, windowDays: number) {
    if (subjectIds.length === 0) {
      return { averageDays: null, resolvedCount: 0, windowDays, byEvaluationKey: [] };
    }
    const [overall, perKey] = await Promise.all([
      this.prisma.$queryRaw<{ averageDays: number | null; resolvedCount: number }[]>`
        SELECT
          avg(extract(epoch from ("resolvedAt" - "firstSeenAt")) / 86400.0)::float8 AS "averageDays",
          count(*)::int AS "resolvedCount"
        FROM "module/evaluation"."EvaluationFinding"
        WHERE "subjectId" IN (${Prisma.join([...subjectIds])}) AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= ${since}
      `,
      // Median needs the window function; average alone would hide a long tail
      // that a few stale findings produce per evaluationKey.
      this.prisma.$queryRaw<
        Array<{ evaluationKey: string; averageDays: number | null; medianDays: number | null; resolvedCount: number }>
      >`
        SELECT
          "evaluationKey" AS "evaluationKey",
          avg(extract(epoch from ("resolvedAt" - "firstSeenAt")) / 86400.0)::float8 AS "averageDays",
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY extract(epoch from ("resolvedAt" - "firstSeenAt"))::float8 / 86400.0
          )::float8 AS "medianDays",
          count(*)::int AS "resolvedCount"
        FROM "module/evaluation"."EvaluationFinding"
        WHERE "subjectId" IN (${Prisma.join([...subjectIds])}) AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
    ]);
    const row = overall[0];
    return {
      averageDays: row?.averageDays ?? null,
      resolvedCount: row?.resolvedCount ?? 0,
      windowDays,
      byEvaluationKey: perKey.map((entry) => ({
        evaluationKey: entry.evaluationKey,
        averageDays: entry.averageDays ?? null,
        medianDays: entry.medianDays ?? null,
        resolvedCount: entry.resolvedCount,
      })),
    };
  }
}

function readUrgency(metadata: Prisma.JsonValue | null): SecurityEvaluationUrgency {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "P4";
  const value = metadata.urgency;
  return value === "P1" || value === "P2" || value === "P3" || value === "P4" ? value : "P4";
}
