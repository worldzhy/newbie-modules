import { Injectable } from "@nestjs/common";
import { EvaluationFindingStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  SECURITY_EVALUATION_ASSET_STALE_AFTER_DAYS,
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
    /**
     * Assets that cannot be evaluated at all right now: their subject kind
     * requires a registered credential reference and none is stored. Surfaced
     * as its own bucket so an un-integrated subject never reads as coverage.
     */
    unevaluable: number;
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

  /**
   * Build the platform report, or a provenance-filtered slice when `subjectIds`
   * is given (ADR-039): `null` means the whole platform, an empty array means
   * the filter matched nothing.
   */
  async getReport(subjectIdsFilter: readonly string[] | null): Promise<SecurityEvaluationReport> {
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
