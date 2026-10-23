import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ClickhouseService } from "@modules/clickhouse/clickhouse.service";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { assertPublicHttpUrl, assertPubliclyResolvable } from "./public-url";

// Global check parameters: 60s cadence is owned by the host's scheduled job;
// the remaining defaults live here so consumers can tweak them without a new
// module release.
const CHECK_TIMEOUT_MS = 10_000;
const ALERT_FAILURE_THRESHOLD = 3;
// Recovery is declared only after this many consecutive successes while the
// alert is open: a single success mid-outage is noise, not recovery.
const RECOVERY_SUCCESS_THRESHOLD = 3;
const PROBE_CONCURRENCY = 10;
const MAX_REDIRECTS = 5;
const CHECK_RESULTS_TABLE = "url_monitor_check_results";
const PROBE_USER_AGENT = "nightwatch-url-check/1.0";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** A target is up when the final response (redirects followed) is < 400. */
const UP_STATUS_CEILING = 400;

/** Fired when a target crosses into an alert-open state. */
export interface UrlCheckDownEvent {
  targetId: string;
  projectId: string;
  name: string;
  url: string;
  error: string;
  consecutiveFailures: number;
  downSince: string; // ISO timestamp
}

/** Fired when a target recovers from an open alert. */
export interface UrlCheckRecoveredEvent {
  targetId: string;
  projectId: string;
  name: string;
  url: string;
  downSince: string; // ISO timestamp, empty when the alert's openAt is null
  recoveredAt: string;
  downtimeMinutes: number;
}

interface ProbeOutcome {
  isUp: boolean;
  statusCode: number | null;
  durationMs: number;
  error: string;
}

interface TargetRow {
  id: string;
  projectId: string;
  name: string;
  url: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  isAlertOpen: boolean;
  alertOpenedAt: Date | null;
}

/** Formats a JS Date to a ClickHouse DateTime64 string (UTC). */
function toClickHouseDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Probe engine for url-check. Every scheduled run probes all active targets,
 * appends one raw row per probe to ClickHouse, and advances the per-target
 * alert state machine in Postgres:
 *
 * - failure increments consecutiveFailures; success resets it to 0;
 * - reaching 3 consecutive failures with no open alert emits url-check.down
 *   and opens the alert plus a matching incident row (same transaction);
 * - while an alert is open, only 3 consecutive successes (recovery hysteresis)
 *   emit url-check.recovered and close both the alert and the incident
 *   (recoveredAt/durationMs, same transaction); a failure resets the success
 *   streak, so a flapping target produces one alert, one incident, and one
 *   recovery instead of a notification storm.
 *
 * The module does NOT wire any alarm transport — it only emits events via
 * EventEmitter2 (url-check.down / url-check.recovered); the host application
 * subscribes and routes through whatever notification channel it chooses.
 */
@Injectable()
export class UrlCheckProbeService {
  private readonly logger = new Logger(UrlCheckProbeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** One full check cycle over every active target, with bounded concurrency. */
  async runChecks(): Promise<void> {
    const targets = (await this.prisma.urlMonitorTarget.findMany({
      where: { isActive: true },
      select: {
        id: true,
        projectId: true,
        name: true,
        url: true,
        consecutiveFailures: true,
        consecutiveSuccesses: true,
        isAlertOpen: true,
        alertOpenedAt: true,
      },
    })) as TargetRow[];

    for (let offset = 0; offset < targets.length; offset += PROBE_CONCURRENCY) {
      const batch = targets.slice(offset, offset + PROBE_CONCURRENCY);
      await Promise.all(
        batch.map(async (target) => {
          try {
            await this.checkTarget(target);
          } catch (error) {
            this.logger.error(
              `Check cycle failed for target ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }
  }

  private async checkTarget(target: TargetRow): Promise<void> {
    const checkedAt = new Date();
    const outcome = await this.probe(target.url);

    await this.recordResult(target, outcome, checkedAt);
    await this.advanceState(target, outcome, checkedAt);
  }

  /**
   * Redirects are followed manually so every hop re-runs the SSRF guard: a
   * public URL that redirects into a private range must be blocked, which
   * fetch's built-in "follow" cannot express. One timeout budget covers the
   * whole redirect chain. The response body is never read — cancel() releases
   * the socket without buffering an unbounded payload into memory.
   */
  private async probe(url: string): Promise<ProbeOutcome> {
    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
    try {
      let currentUrl = url;
      for (let hop = 0; ; hop++) {
        assertPublicHttpUrl(currentUrl);
        await assertPubliclyResolvable(currentUrl);
        const response = await fetch(currentUrl, {
          redirect: "manual",
          signal: timeout,
          headers: { "user-agent": PROBE_USER_AGENT },
        });
        await response.body?.cancel().catch(() => undefined);
        if (REDIRECT_STATUSES.has(response.status) && response.headers.get("location")) {
          if (hop >= MAX_REDIRECTS) {
            throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
          }
          currentUrl = new URL(response.headers.get("location") as string, currentUrl).href;
          continue;
        }
        return {
          isUp: response.status < UP_STATUS_CEILING,
          statusCode: response.status,
          durationMs: Date.now() - startedAt,
          error: "",
        };
      }
    } catch (error) {
      return {
        isUp: false,
        statusCode: null,
        durationMs: Date.now() - startedAt,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      };
    }
  }

  private async recordResult(target: TargetRow, outcome: ProbeOutcome, checkedAt: Date): Promise<void> {
    try {
      await this.clickhouse.insert({
        table: CHECK_RESULTS_TABLE,
        values: [
          {
            target_id: target.id,
            project_id: target.projectId,
            url: target.url,
            is_up: outcome.isUp,
            status_code: outcome.statusCode,
            duration_ms: outcome.durationMs,
            error: outcome.error,
            checked_at: toClickHouseDate(checkedAt),
          },
        ],
        format: "JSONEachRow",
      });
    } catch (error) {
      // Result history must not block state transitions; the row is lost but
      // the alert path stays correct.
      this.logger.error(
        `Failed to record check result for target ${target.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async advanceState(target: TargetRow, outcome: ProbeOutcome, checkedAt: Date): Promise<void> {
    const consecutiveFailures = outcome.isUp ? 0 : target.consecutiveFailures + 1;
    // The success streak only runs while an alert is open; outside an outage
    // it stays 0 so the column always reads as "recovery progress".
    const consecutiveSuccesses = outcome.isUp && target.isAlertOpen ? target.consecutiveSuccesses + 1 : 0;
    const opensAlert = !outcome.isUp && consecutiveFailures >= ALERT_FAILURE_THRESHOLD && !target.isAlertOpen;
    const closesAlert = outcome.isUp && target.isAlertOpen && consecutiveSuccesses >= RECOVERY_SUCCESS_THRESHOLD;
    const outageContinues = !outcome.isUp && target.isAlertOpen;

    // Target rolling columns and the incident row are written in one
    // transaction: an open alert always has a matching open incident, and a
    // closed alert always has a closed incident.
    await this.prisma.$transaction(async (tx) => {
      await tx.urlMonitorTarget.update({
        where: { id: target.id },
        data: {
          consecutiveFailures,
          consecutiveSuccesses,
          lastCheckedAt: checkedAt,
          lastStatusCode: outcome.statusCode,
          lastIsUp: outcome.isUp,
          ...(opensAlert ? { isAlertOpen: true, alertOpenedAt: checkedAt } : {}),
          ...(closesAlert ? { isAlertOpen: false, alertOpenedAt: null, consecutiveSuccesses: 0 } : {}),
        },
      });

      if (opensAlert) {
        await tx.urlMonitorIncident.create({
          data: { targetId: target.id, openedAt: checkedAt, peakConsecutiveFailures: consecutiveFailures },
        });
      } else if (closesAlert) {
        await tx.urlMonitorIncident.updateMany({
          where: { targetId: target.id, recoveredAt: null },
          data: {
            recoveredAt: checkedAt,
            durationMs: target.alertOpenedAt ? checkedAt.getTime() - target.alertOpenedAt.getTime() : null,
          },
        });
      } else if (outageContinues) {
        // Keep the incident's peak failure count current while the outage lasts.
        await tx.urlMonitorIncident.updateMany({
          where: { targetId: target.id, recoveredAt: null, peakConsecutiveFailures: { lt: consecutiveFailures } },
          data: { peakConsecutiveFailures: consecutiveFailures },
        });
      }
    });

    if (opensAlert) {
      this.emitDown(target, outcome, checkedAt, consecutiveFailures);
    } else if (closesAlert) {
      this.emitRecovered(target, checkedAt);
    }
  }

  private emitDown(target: TargetRow, outcome: ProbeOutcome, openedAt: Date, consecutiveFailures: number): void {
    try {
      const event: UrlCheckDownEvent = {
        targetId: target.id,
        projectId: target.projectId,
        name: target.name,
        url: target.url,
        error: outcome.error || (outcome.statusCode !== null ? `HTTP ${outcome.statusCode}` : ""),
        consecutiveFailures,
        downSince: openedAt.toISOString(),
      };
      this.eventEmitter.emit("url-check.down", event);
    } catch (error) {
      this.logger.error(
        `Failed to emit url-check.down for target ${target.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private emitRecovered(target: TargetRow, recoveredAt: Date): void {
    const openedAt = target.alertOpenedAt;
    try {
      const event: UrlCheckRecoveredEvent = {
        targetId: target.id,
        projectId: target.projectId,
        name: target.name,
        url: target.url,
        downSince: openedAt ? openedAt.toISOString() : "",
        recoveredAt: recoveredAt.toISOString(),
        downtimeMinutes: openedAt ? Math.max(0, Math.round((recoveredAt.getTime() - openedAt.getTime()) / 60000)) : 0,
      };
      this.eventEmitter.emit("url-check.recovered", event);
    } catch (error) {
      this.logger.error(
        `Failed to emit url-check.recovered for target ${target.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
