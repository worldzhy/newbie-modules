import { Injectable, NotFoundException } from "@nestjs/common";
import { ClickhouseService } from "@modules/clickhouse/clickhouse.service";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { assertPublicHttpUrl } from "./public-url";
import {
  CreateUrlMonitorTargetDto,
  DeleteUrlMonitorTargetResponseDto,
  UpdateUrlMonitorTargetDto,
  UrlMonitorCheckResultDto,
  UrlMonitorIncidentDto,
  UrlMonitorLatencyBucketDto,
  UrlMonitorTargetStatsDto,
} from "./url-check.dto";

const CHECK_RESULTS_TABLE = "url_monitor_check_results";
const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 200;

type StatsWindow = "24h" | "7d" | "30d";

const STATS_WINDOW_HOURS: Record<StatsWindow, number> = { "24h": 24, "7d": 168, "30d": 720 };

// Bucket granularity per window, aiming at roughly 24-30 chart points. The
// expression is interpolated into the aggregation query; the values are fixed
// server-side constants, never derived from the request.
const STATS_BUCKET_EXPRESSION: Record<StatsWindow, string> = {
  "24h": "toStartOfHour(checked_at)",
  "7d": "toStartOfInterval(checked_at, INTERVAL 6 HOUR)",
  "30d": "toStartOfDay(checked_at)",
};

/**
 * Admin-side store for url-check targets: project-owned CRUD in Postgres plus
 * read access to the raw check results in ClickHouse. Probe execution and the
 * alert state machine live in UrlCheckProbeService.
 */
@Injectable()
export class UrlCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService,
  ) {}

  list(projectId: string) {
    return this.prisma.urlMonitorTarget.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(body: CreateUrlMonitorTargetDto, createdByUserId: string) {
    assertPublicHttpUrl(body.url);
    await this.assertProject(body.projectId);
    return this.prisma.urlMonitorTarget.create({
      data: {
        projectId: body.projectId,
        name: body.name,
        url: body.url,
        createdByUserId,
      },
    });
  }

  async getById(targetId: string) {
    const target = await this.prisma.urlMonitorTarget.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException(`URL check target not found: ${targetId}`);
    }
    return target;
  }

  async update(targetId: string, body: UpdateUrlMonitorTargetDto) {
    const target = await this.getById(targetId);
    if (body.url !== undefined) {
      assertPublicHttpUrl(body.url);
    }
    // Pausing a target stops probing, so an alert open at that moment would
    // otherwise stay open forever. Close it (and its incident) in the same
    // transaction instead. The incident keeps the observed duration — no
    // recovery notification is emitted because nothing actually recovered.
    const closesOnPause = body.isActive === false && target.isAlertOpen;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.urlMonitorTarget.update({
        where: { id: targetId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(closesOnPause ? { isAlertOpen: false, alertOpenedAt: null } : {}),
        },
      });
      if (closesOnPause) {
        const closedAt = new Date();
        await tx.urlMonitorIncident.updateMany({
          where: { targetId, recoveredAt: null },
          data: {
            recoveredAt: closedAt,
            durationMs: target.alertOpenedAt ? closedAt.getTime() - target.alertOpenedAt.getTime() : null,
          },
        });
      }
      return updated;
    });
  }

  async delete(targetId: string) {
    await this.getById(targetId);
    await this.prisma.urlMonitorTarget.delete({ where: { id: targetId } });
    return { success: true } as DeleteUrlMonitorTargetResponseDto;
  }

  /** Recent raw check results for one target, newest first. */
  async listCheckResults(targetId: string, limitQuery?: string): Promise<UrlMonitorCheckResultDto[]> {
    await this.getById(targetId);
    const parsedLimit = Number.parseInt(limitQuery ?? "", 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_RESULT_LIMIT) : DEFAULT_RESULT_LIMIT;

    const result = await this.clickhouse.query({
      query: `SELECT is_up AS isUp, status_code AS statusCode, duration_ms AS durationMs, error, checked_at AS checkedAt
              FROM ${CHECK_RESULTS_TABLE}
              WHERE target_id = {targetId: UUID}
              ORDER BY checked_at DESC
              LIMIT {limit: UInt32}`,
      query_params: { targetId, limit },
      format: "JSONEachRow",
    });
    return (await result.json()) as UrlMonitorCheckResultDto[];
  }

  /** Outage incidents of one target, newest first. */
  async listIncidents(targetId: string, limitQuery?: string): Promise<UrlMonitorIncidentDto[]> {
    await this.getById(targetId);
    const parsedLimit = Number.parseInt(limitQuery ?? "", 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_RESULT_LIMIT) : DEFAULT_RESULT_LIMIT;

    return this.prisma.urlMonitorIncident.findMany({
      where: { targetId },
      orderBy: { openedAt: "desc" },
      take: limit,
    });
  }

  /**
   * Availability, MTTR and latency stats of one target over a trailing window.
   * Availability and latency aggregate the raw ClickHouse rows on the fly; MTTR
   * aggregates closed incidents in Postgres.
   * Availability is count-based, which equals the time-weighted ratio under
   * the fixed 60s probe cadence.
   */
  async getStats(targetId: string, windowQuery?: string): Promise<UrlMonitorTargetStatsDto> {
    await this.getById(targetId);
    const window: StatsWindow = windowQuery === "7d" || windowQuery === "30d" ? windowQuery : "24h";
    const hours = STATS_WINDOW_HOURS[window];
    const since = new Date(Date.now() - hours * 3_600_000);

    const [totalsResult, bucketsResult, incidentAggregate] = await Promise.all([
      this.clickhouse.query({
        query: `SELECT toUInt32(count()) AS totalChecks, toUInt32(countIf(is_up)) AS upChecks
                FROM ${CHECK_RESULTS_TABLE}
                WHERE target_id = {targetId: UUID}
                  AND checked_at >= now64() - INTERVAL ${hours} HOUR`,
        query_params: { targetId },
        format: "JSONEachRow",
      }),
      // Latency percentiles cover successful probes only: a failed probe's
      // duration is the timeout, which is a failure signal, not latency. The
      // if() guard keeps ClickHouse from emitting NaN on buckets without any
      // successful probe.
      this.clickhouse.query({
        query: `SELECT toUnixTimestamp(${STATS_BUCKET_EXPRESSION[window]}) AS bucketStart,
                       toUInt32(count()) AS totalChecks,
                       toUInt32(countIf(is_up)) AS upChecks,
                       if(upChecks = 0, NULL, round(avgIf(duration_ms, is_up), 1)) AS avgDurationMs,
                       if(upChecks = 0, NULL, round(quantileIf(0.5)(duration_ms, is_up), 1)) AS p50DurationMs,
                       if(upChecks = 0, NULL, round(quantileIf(0.95)(duration_ms, is_up), 1)) AS p95DurationMs,
                       if(upChecks = 0, NULL, round(quantileIf(0.99)(duration_ms, is_up), 1)) AS p99DurationMs
                FROM ${CHECK_RESULTS_TABLE}
                WHERE target_id = {targetId: UUID}
                  AND checked_at >= now64() - INTERVAL ${hours} HOUR
                GROUP BY bucketStart
                ORDER BY bucketStart`,
        query_params: { targetId },
        format: "JSONEachRow",
      }),
      // MTTR is incident-scoped by definition; only incidents closed in the
      // window carry a complete duration.
      this.prisma.urlMonitorIncident.aggregate({
        where: { targetId, recoveredAt: { not: null, gte: since } },
        _count: true,
        _avg: { durationMs: true },
      }),
    ]);

    const totals = ((await totalsResult.json()) as { totalChecks: number; upChecks: number }[])[0] ?? {
      totalChecks: 0,
      upChecks: 0,
    };
    const latency = (await bucketsResult.json()) as UrlMonitorLatencyBucketDto[];

    return {
      window,
      totalChecks: totals.totalChecks,
      upChecks: totals.upChecks,
      availability: totals.totalChecks > 0 ? Math.round((totals.upChecks / totals.totalChecks) * 10000) / 10000 : null,
      closedIncidents: incidentAggregate._count,
      mttrMs: incidentAggregate._avg.durationMs === null ? null : Math.round(incidentAggregate._avg.durationMs),
      latency,
    };
  }

  private async assertProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }
  }
}
