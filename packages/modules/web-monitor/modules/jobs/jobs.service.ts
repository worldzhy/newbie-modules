import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RedisService } from "../../models/redis/redis.service";
import { SystemService } from "../../modules/system/system.service";
import { NodeCacheService } from "../../shared/node-cache.service";
import { func } from "../../shared/utils";
import { DayReportNumService } from "../../modules/day-report/day-report-num.service";
import { RedisKeys } from "../../models/enum";
import { WebReportTaskService } from "../../modules/web/services/report-task.service";
import { WebPvuvipTaskService } from "../../modules/web/services/pvuvip-task.service";
import { WebIpTaskService } from "../../modules/web/services/ip-task.service";
import { MonitorModelsService } from "../../models/mongo/monitor-models.service";
import { MonitorClickhouseService } from "../../models/clickhouse/monitor-clickhouse.service";
import { WEB_THRESHOLD_ALERT_EVENT, WebThresholdAlertCategory, WebThresholdAlertEvent } from "./threshold-alert.event";
import ip from "ip";

@Injectable()
export class JobsService implements OnModuleInit {
  private cfg: any;
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly system: SystemService,
    private readonly nodeCache: NodeCacheService,
    private readonly dayReportNum: DayReportNumService,
    private readonly scheduler: SchedulerRegistry,
    private readonly webReportTask: WebReportTaskService,
    private readonly webPvuvipTask: WebPvuvipTaskService,
    private readonly webIpTask: WebIpTaskService,
    private readonly models: MonitorModelsService,
    private readonly clickhouse: MonitorClickhouseService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.cfg = this.configService.get("modules.web-monitor");
  }

  async onModuleInit() {
    await this.updateAppInfoCache();
    await this.pvuvipMinuteCount();
    await this.ipTask();
    await this.dayReportNumTask();
    this.registerReportStoreTask();
    this.registerAlertEvaluationTask();
  }

  private registerReportStoreTask() {
    const expr = this.cfg.redis_consumption?.task_time || "*/10 * * * * *";
    const job = new CronJob(
      expr,
      async () => {
        await this.consumeReportQueues();
      },
      null,
      true,
      "Asia/Shanghai",
    );
    this.scheduler.addCronJob("consumeReportQueues", job);
    job.start();
  }

  private registerAlertEvaluationTask() {
    const expr = this.cfg.alertTaskCronTime;
    if (!expr) return;
    const job = new CronJob(
      expr,
      async () => {
        await this.evaluateThresholdAlerts();
      },
      null,
      true,
      "Asia/Shanghai",
    );
    this.scheduler.addCronJob("evaluateThresholdAlerts", job);
    job.start();
  }

  // Minimum breaching occurrences within one evaluation window before a
  // signal fires. Every web system is evaluated; these gates keep a single
  // slow resource from producing an alert every minute.
  private static readonly MIN_SLOW_PAGE_COUNT = 1;
  private static readonly MIN_SLOW_RESOURCE_COUNT = 3;
  private static readonly MIN_SLOW_AJAX_COUNT = 3;
  private static readonly JS_ERROR_SPIKE_COUNT = 10;
  private static readonly TOP_ITEMS_LIMIT = 3;

  async evaluateThresholdAlerts() {
    const acquired = await this.redisLock(RedisKeys.ALERT_EVALUATION_TASK_LOCK, this.cfg.alertTaskLockTime);
    if (!acquired) return;

    let systems: any[];
    try {
      systems = await this.system.getWebSystemList();
    } catch (error) {
      this.logger.error(`Threshold alert evaluation failed to load systems: ${this.getErrorMessage(error)}`);
      return;
    }

    const windowMs = Number(this.cfg.alertWindowMs) || 60000;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowMs);
    for (const system of systems) {
      if (!system?.appId) continue;
      try {
        await this.evaluateSystem(system, windowStart, windowEnd, windowMs);
      } catch (error) {
        this.logger.error(
          `Threshold alert evaluation failed for system ${system.appId}: ${this.getErrorMessage(error)}`,
        );
      }
    }
  }

  private async evaluateSystem(system: any, windowStart: Date, windowEnd: Date, windowMs: number) {
    const base = {
      appId: system.appId,
      systemName: system.systemName || system.appId,
      projectId: system.projectId,
      windowMs,
      windowStartedAt: windowStart.toISOString(),
    };

    await this.runSignal("slow pages", async () => {
      const pageModel = this.models.WebPage(system.appId);
      const match = { createTime: { $gte: windowStart, $lt: windowEnd }, speedType: 2 };
      const [count, topRows] = await Promise.all([
        pageModel.countDocuments(match),
        pageModel.aggregate([
          { $match: match },
          { $group: { _id: "$url", count: { $sum: 1 }, maxLoadTime: { $max: "$loadTime" } } },
          { $sort: { count: -1 } },
          { $limit: JobsService.TOP_ITEMS_LIMIT },
        ]),
      ]);
      if (count >= JobsService.MIN_SLOW_PAGE_COUNT) {
        this.emitAlert({
          ...base,
          signal: "slow-page",
          severity: "medium",
          count,
          thresholdMs: (system.slowPageTime ?? 5) * 1000,
          topItems: topRows.map(
            (row: any) => `${row._id || "Unknown page"} — ${row.count} load(s), max ${row.maxLoadTime ?? 0}ms`,
          ),
        });
      }
    });

    // Only slow resources are persisted (see saveResours), so every row in
    // the window already breached its category threshold at ingest time.
    const categories: {
      category: WebThresholdAlertCategory;
      types: string[];
      thresholdSeconds: number;
    }[] = [
      { category: "js", types: ["script"], thresholdSeconds: system.slowJsTime ?? 2 },
      { category: "css", types: ["link", "css"], thresholdSeconds: system.slowCssTime ?? 2 },
      { category: "img", types: ["img"], thresholdSeconds: system.slowImgTime ?? 2 },
    ];
    const resourceModel = this.models.WebResource(system.appId);
    for (const { category, types, thresholdSeconds } of categories) {
      await this.runSignal(`slow ${category} resources`, async () => {
        const match = { createTime: { $gte: windowStart, $lt: windowEnd }, type: { $in: types } };
        const [count, topRows] = await Promise.all([
          resourceModel.countDocuments(match),
          resourceModel.aggregate([
            { $match: match },
            { $group: { _id: "$name", count: { $sum: 1 }, maxDuration: { $max: "$duration" } } },
            { $sort: { count: -1 } },
            { $limit: JobsService.TOP_ITEMS_LIMIT },
          ]),
        ]);
        if (count >= JobsService.MIN_SLOW_RESOURCE_COUNT) {
          this.emitAlert({
            ...base,
            signal: "slow-resource",
            category,
            severity: "medium",
            count,
            thresholdMs: thresholdSeconds * 1000,
            topItems: topRows.map(
              (row: any) => `${row._id || "Unknown resource"} — ${row.count} load(s), max ${row.maxDuration ?? 0}ms`,
            ),
          });
        }
      });
    }

    await this.runSignal("slow ajax", async () => {
      const ajaxModel = await this.clickhouse.WebAjax(system.appId);
      const thresholdMs = (system.slowAjaxTime ?? 2) * 1000;
      const timeFilter = this.buildClickhouseTimeFilter(windowStart, windowEnd);
      const filter = `${timeFilter} AND duration >= ${thresholdMs}`;
      const countRows = await ajaxModel.find({ where: filter, select: "count() AS total" });
      const count = parseInt(countRows[0]?.total ?? "0", 10);
      if (count >= JobsService.MIN_SLOW_AJAX_COUNT) {
        const topRows = await ajaxModel.find({
          where: filter,
          select: "url, COUNT() AS count, MAX(duration) AS maxDuration",
          groupBy: "url",
          orderBy: "count DESC",
          limit: JobsService.TOP_ITEMS_LIMIT,
        });
        this.emitAlert({
          ...base,
          signal: "slow-ajax",
          severity: "medium",
          count,
          thresholdMs,
          topItems: topRows.map(
            (row: any) => `${row.url || "Unknown endpoint"} — ${row.count} call(s), max ${row.maxDuration ?? 0}ms`,
          ),
        });
      }
    });

    await this.runSignal("js error spike", async () => {
      const errorModel = await this.clickhouse.WebError(system.appId);
      const timeFilter = this.buildClickhouseTimeFilter(windowStart, windowEnd);
      const countRows = await errorModel.find({ where: timeFilter, select: "count() AS total" });
      const count = parseInt(countRows[0]?.total ?? "0", 10);
      if (count >= JobsService.JS_ERROR_SPIKE_COUNT) {
        const topRows = await errorModel.find({
          where: timeFilter,
          select: "name, type, resourceUrl, COUNT() AS count",
          groupBy: "name, type, resourceUrl",
          orderBy: "count DESC",
          limit: JobsService.TOP_ITEMS_LIMIT,
        });
        this.emitAlert({
          ...base,
          signal: "js-error-spike",
          severity: "high",
          count,
          topItems: topRows.map(
            (row: any) =>
              `[${row.type || "Error"}] ${row.name || "Unknown error"} @ ${row.resourceUrl || ""} — ${row.count}`,
          ),
        });
      }
    });
  }

  private async runSignal(name: string, evaluate: () => Promise<void>) {
    try {
      await evaluate();
    } catch (error) {
      // One failing signal (e.g. a not-yet-created per-app table) must not
      // suppress the remaining signals for the same system.
      this.logger.warn(`Threshold alert signal "${name}" failed: ${this.getErrorMessage(error)}`);
    }
  }

  private emitAlert(event: WebThresholdAlertEvent) {
    try {
      this.eventEmitter.emit(WEB_THRESHOLD_ALERT_EVENT, event);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${WEB_THRESHOLD_ALERT_EVENT} for system ${event.appId} (${event.signal}): ${this.getErrorMessage(error)}`,
      );
    }
  }

  private buildClickhouseTimeFilter(windowStart: Date, windowEnd: Date): string {
    return (
      `createTime >= toDateTime('${this.toShanghaiDateTime(windowStart)}', 'Asia/Shanghai') ` +
      `AND createTime < toDateTime('${this.toShanghaiDateTime(windowEnd)}', 'Asia/Shanghai')`
    );
  }

  /** Formats a Date as a ClickHouse datetime literal in Asia/Shanghai (UTC+8). */
  private toShanghaiDateTime(date: Date): string {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async redisLock(redisKey: string, ttl: number) {
    const lock = `${ip.address()}:${this.cfg.port}:${func.randomString(3)}`;
    const res = await this.redis.set(redisKey, lock, "EX", ttl, "NX");
    if (!res) {
      // Lock is held by another instance — normal in multi-instance deployments.
      // Log at verbose level so it doesn't spam the console every minute.
      this.logger.verbose(`Lock [${redisKey}] not acquired (held by another instance)`);
      return false;
    }
    const dbLock = await this.redis.get(redisKey);
    if (lock !== dbLock) {
      // Lock verification failed — could indicate a race or Redis issue, worth warning.
      this.logger.warn(`Lock [${redisKey}] verification failed: expected ${lock}, got ${dbLock}`);
      return false;
    }
    // Lock acquired successfully — normal event, log at verbose level to avoid noise.
    this.logger.verbose(`Lock [${redisKey}] acquired: ${lock}`);
    return true;
  }

  @Cron("0 */5 * * * *", { timeZone: "Asia/Shanghai" })
  async updateAppInfoCache() {
    try {
      const systems = await this.system.getSystemList();
      this.nodeCache.updateAllSystemCache(systems as any);
    } catch (e) {
      console.error("IO error: failed to update cached appId info", e?.message || e);
    }
  }

  @Cron("0 */2 * * * *", { timeZone: "Asia/Shanghai" })
  async pvuvipMinuteCount() {
    const getLock = await this.redisLock(RedisKeys.PVUVIP_PRE_MINUTE_LOCK, this.cfg.pvuvip_task_minute_lock_time);
    if (!getLock) return;
    await this.webPvuvipTask.getWebPvUvIpByMinute();
  }

  @Cron("0 */1 * * * *", { timeZone: "Asia/Shanghai" })
  async ipTask() {
    const getLock = await this.redisLock(RedisKeys.IP_TASK_LOCK, this.cfg.ip_task_lock_time);
    if (!getLock) return;
    await this.webIpTask.saveWebGetIpDatas();
  }

  @Cron("0 0 0 */1 * *", { timeZone: "Asia/Shanghai" })
  async dayReportNumTask() {
    const getLock = await this.redisLock(RedisKeys.DAY_REPORT_NUM_TASK_LOCK, this.cfg.day_report_num_task_lock_time);
    if (!getLock) return;
    await this.dayReportNum.numCountTask();
  }

  async consumeReportQueues() {
    // Use the cron expression from configuration
    try {
      if (this.cfg.is_web_consume_task_run) await this.consumeWebQueue();
    } catch (e) {
      console.error("Consumer queue exception", e?.message || e);
    }
    // Can later be split into a standalone cron job if needed
  }

  private async consumeWebQueue() {
    await this.webReportTask.saveWebReportDatasForRedis();
  }
}
