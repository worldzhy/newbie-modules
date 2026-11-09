import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RedisService } from "@modules/redis/redis.service";
import { SiteService } from "@modules/web-monitor/modules/site/site.service";
import { NodeCacheService } from "../../shared/node-cache.service";
import { func } from "../../shared/utils";
import { WEB_MONITOR_CONFIG } from "../../shared/web-monitor-config";
import { DayReportNumService } from "@modules/web-monitor/modules/day-report/day-report-num.service";
import { RedisKeys } from "../../models/enum";
import { WebReportTaskService } from "@modules/web-monitor/modules/web/services/report-task.service";
import { WebPvuvipTaskService } from "@modules/web-monitor/modules/web/services/pvuvip-task.service";
import { WebIpTaskService } from "@modules/web-monitor/modules/web/services/ip-task.service";
import { WebMonitorModelsService } from "../../models/mongo/web-monitor-models.service";
import { WebMonitorClickHouseService } from "../../models/clickhouse/web-monitor-clickhouse.service";
import { SystemDocument } from "../../models/mongo/system.schema";
import {
  WEB_THRESHOLD_ALERT_EVENT,
  WebThresholdAlertCategory,
  WebThresholdAlertEvent,
  WebThresholdAlertSignal,
} from "./threshold-alert.event";
import { FIRST_SEEN_SOURCE_FILTER, SPIKE_SOURCE_FILTER } from "./error-source";
import { AlertStateMachine } from "./alert-state";
import * as os from "os";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

@Injectable()
export class JobsService implements OnModuleInit {
  private cfg: Record<string, unknown>;
  private readonly logger = new Logger(JobsService.name);
  private readonly alertState: AlertStateMachine;

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly site: SiteService,
    private readonly nodeCache: NodeCacheService,
    private readonly dayReportNum: DayReportNumService,
    private readonly scheduler: SchedulerRegistry,
    private readonly webReportTask: WebReportTaskService,
    private readonly webPvuvipTask: WebPvuvipTaskService,
    private readonly webIpTask: WebIpTaskService,
    private readonly models: WebMonitorModelsService,
    private readonly clickhouse: WebMonitorClickHouseService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.cfg = this.configService.get("modules.web-monitor") || {};
    this.alertState = new AlertStateMachine(this.redis, this.logger);
  }

  // Periodic scheduling lives in the consumer's application layer
  // (job-scheduler ScheduledJob classes calling the public methods below).
  // This module only keeps the high-frequency report-queue consumer loop,
  // which intentionally stays a plain CronJob outside job-scheduler.
  async onModuleInit() {
    this.registerReportStoreTask();
  }

  private registerReportStoreTask() {
    const consumption = WEB_MONITOR_CONFIG.redis_consumption;
    const expr = consumption.task_time;
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

  // Minimum breaching occurrences within one evaluation window before a
  // signal fires. Every web system is evaluated; these gates keep a single
  // slow load from producing an alert every minute.
  private static readonly MIN_SLOW_PAGE_COUNT = 2;
  private static readonly MIN_SLOW_FIRST_PAINT_COUNT = 2;
  private static readonly MIN_SLOW_RESOURCE_COUNT = 3;
  private static readonly MIN_SLOW_AJAX_COUNT = 3;
  // A spike needs enough errors AND enough distinct visitors, so one user
  // stuck in an error loop cannot page the channel group.
  private static readonly JS_ERROR_SPIKE_COUNT = 10;
  private static readonly JS_ERROR_SPIKE_USER_COUNT = 2;
  private static readonly NEW_ERROR_LIMIT = 3;
  private static readonly TOP_ITEMS_LIMIT = 3;

  async evaluateThresholdAlerts() {
    // ADR-051 fail-open: without Redis (not configured, or down mid-run) there
    // is no cross-instance lock and no lifecycle state. Evaluation still runs;
    // each signal degrades to firing every window and the notification
    // center's minute-bucket deduplication limits the repeat rate — alerts
    // must never go silent during a Redis outage.
    if (this.redis.isConfigured()) {
      let acquired = false;
      try {
        acquired = await this.redisLock(RedisKeys.ALERT_EVALUATION_TASK_LOCK, WEB_MONITOR_CONFIG.alertTaskLockTime);
      } catch (error) {
        this.logger.error(
          `Alert evaluation lock failed (Redis error), proceeding without it: ${getErrorMessage(error)}`,
        );
        acquired = true;
      }
      if (!acquired) return;
    }

    let systems: SystemDocument[];
    try {
      systems = await this.site.getWebSiteList();
    } catch (error) {
      this.logger.error(`Threshold alert evaluation failed to load systems: ${getErrorMessage(error)}`);
      return;
    }

    const windowMs = WEB_MONITOR_CONFIG.alertWindowMs;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowMs);
    // Bounded worker pool: evaluate systems in parallel but cap concurrency so a
    // large system list cannot stampede Mongo/ClickHouse at once.
    const concurrency = 5;
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, systems.length) }, async () => {
      while (nextIndex < systems.length) {
        const system = systems[nextIndex++];
        if (!system?.appKey) continue;
        try {
          await this.evaluateSystem(system, windowStart, windowEnd, windowMs);
        } catch (error) {
          this.logger.error(`Threshold alert evaluation failed for system ${system.appKey}: ${getErrorMessage(error)}`);
        }
      }
    });
    await Promise.all(workers);
  }

  private async evaluateSystem(system: SystemDocument, windowStart: Date, windowEnd: Date, windowMs: number) {
    const base = {
      appKey: system.appKey,
      systemName: system.systemName || system.appKey,
      windowMs,
      windowStartedAt: windowStart.toISOString(),
    };

    await this.runSignal("slow pages", async () => {
      const pageModel = this.models.WebPage(system.appKey);
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
        const key = this.alertStateKey(base.appKey, "slow-page");
        if (await this.alertState.shouldFire(key)) {
          this.emitAlert({
            ...base,
            signal: "slow-page",
            phase: "firing",
            severity: "medium",
            count,
            thresholdMs: (system.slowPageTime ?? 5) * 1000,
            topItems: topRows.map(
              (row: Record<string, unknown>) =>
                `${row._id || "Unknown page"} — ${row.count} load(s), max ${row.maxLoadTime ?? 0}ms`,
            ),
          });
        }
      } else if (await this.alertState.recoverIfClean(this.alertStateKey(base.appKey, "slow-page"))) {
        this.emitAlert({
          ...base,
          signal: "slow-page",
          phase: "recovered",
          severity: "medium",
          count: 0,
          thresholdMs: (system.slowPageTime ?? 5) * 1000,
          topItems: [],
        });
      }
    });

    await this.runSignal("slow first paints", async () => {
      const pageModel = this.models.WebPage(system.appKey);
      const paintThresholdMs = (system.slowWhiteTime ?? 2) * 1000;
      const match = { createTime: { $gte: windowStart, $lt: windowEnd }, whiteTime: { $gte: paintThresholdMs } };
      const [count, topRows] = await Promise.all([
        pageModel.countDocuments(match),
        pageModel.aggregate([
          { $match: match },
          { $group: { _id: "$url", count: { $sum: 1 }, maxWhiteTime: { $max: "$whiteTime" } } },
          { $sort: { count: -1 } },
          { $limit: JobsService.TOP_ITEMS_LIMIT },
        ]),
      ]);
      if (count >= JobsService.MIN_SLOW_FIRST_PAINT_COUNT) {
        const key = this.alertStateKey(base.appKey, "slow-first-paint");
        if (await this.alertState.shouldFire(key)) {
          this.emitAlert({
            ...base,
            signal: "slow-first-paint",
            phase: "firing",
            severity: "medium",
            count,
            thresholdMs: paintThresholdMs,
            topItems: topRows.map(
              (row: Record<string, unknown>) =>
                `${row._id || "Unknown page"} — ${row.count} load(s), max first paint ${row.maxWhiteTime ?? 0}ms`,
            ),
          });
        }
      } else if (await this.alertState.recoverIfClean(this.alertStateKey(base.appKey, "slow-first-paint"))) {
        this.emitAlert({
          ...base,
          signal: "slow-first-paint",
          phase: "recovered",
          severity: "medium",
          count: 0,
          thresholdMs: paintThresholdMs,
          topItems: [],
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
    for (const { category, types, thresholdSeconds } of categories) {
      await this.runSignal(`slow ${category} resources`, async () => {
        const resourceModel = this.models.WebResource(system.appKey);
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
          const key = this.alertStateKey(base.appKey, "slow-resource", category);
          if (await this.alertState.shouldFire(key)) {
            this.emitAlert({
              ...base,
              signal: "slow-resource",
              phase: "firing",
              category,
              severity: "medium",
              count,
              thresholdMs: thresholdSeconds * 1000,
              topItems: topRows.map(
                (row: Record<string, unknown>) =>
                  `${row._id || "Unknown resource"} — ${row.count} load(s), max ${row.maxDuration ?? 0}ms`,
              ),
            });
          }
        } else if (await this.alertState.recoverIfClean(this.alertStateKey(base.appKey, "slow-resource", category))) {
          this.emitAlert({
            ...base,
            signal: "slow-resource",
            phase: "recovered",
            category,
            severity: "medium",
            count: 0,
            thresholdMs: thresholdSeconds * 1000,
            topItems: [],
          });
        }
      });
    }

    await this.runSignal("slow ajax", async () => {
      const ajaxModel = await this.clickhouse.WebAjax(system.appKey);
      const thresholdMs = (system.slowAjaxTime ?? 2) * 1000;
      const timeFilter = this.buildClickHouseTimeFilter(windowStart, windowEnd);
      const filter = `${timeFilter.where} AND duration >= {thresholdMs:UInt32}`;
      const queryParams = { ...timeFilter.queryParams, thresholdMs };
      const countRows = await ajaxModel.find({ where: filter, select: "count() AS total", queryParams });
      const count = parseInt(String(countRows[0]?.total ?? "0"), 10);
      if (count >= JobsService.MIN_SLOW_AJAX_COUNT) {
        const topRows = await ajaxModel.find({
          where: filter,
          select: "url, COUNT() AS count, MAX(duration) AS maxDuration",
          groupBy: "url",
          orderBy: "count DESC",
          limit: JobsService.TOP_ITEMS_LIMIT,
          queryParams,
        });
        const key = this.alertStateKey(base.appKey, "slow-ajax");
        if (await this.alertState.shouldFire(key)) {
          this.emitAlert({
            ...base,
            signal: "slow-ajax",
            phase: "firing",
            severity: "medium",
            count,
            thresholdMs,
            topItems: topRows.map(
              (row: Record<string, unknown>) =>
                `${row.url || "Unknown endpoint"} — ${row.count} call(s), max ${row.maxDuration ?? 0}ms`,
            ),
          });
        }
      } else if (await this.alertState.recoverIfClean(this.alertStateKey(base.appKey, "slow-ajax"))) {
        this.emitAlert({
          ...base,
          signal: "slow-ajax",
          phase: "recovered",
          severity: "medium",
          count: 0,
          thresholdMs,
          topItems: [],
        });
      }
    });

    await this.runSignal("js error spike", async () => {
      const errorModel = await this.clickhouse.WebError(system.appKey);
      const timeFilter = this.buildClickHouseTimeFilter(windowStart, windowEnd);
      // Count both errors and distinct identified visitors. Anonymous
      // traffic (empty markUser) cannot be attributed, so the user gate only
      // applies when at least one visitor in the window is identifiable.
      // Console rows are diagnostics rather than an error rate (ADR-050); the
      // count and the top-items grouping share the same source predicate.
      const countRows = await errorModel.find({
        where: `${timeFilter.where} AND ${SPIKE_SOURCE_FILTER}`,
        select: "count() AS total, uniqExactIf(markUser, markUser != '') AS markedUsers",
        queryParams: timeFilter.queryParams,
      });
      const count = parseInt(String(countRows[0]?.total ?? "0"), 10);
      const markedUsers = parseInt(String(countRows[0]?.markedUsers ?? "0"), 10);
      const enoughUsers = markedUsers === 0 || markedUsers >= JobsService.JS_ERROR_SPIKE_USER_COUNT;
      const breach = count >= JobsService.JS_ERROR_SPIKE_COUNT && enoughUsers;
      const key = this.alertStateKey(base.appKey, "js-error-spike");
      if (breach) {
        const topRows = await errorModel.find({
          where: `${timeFilter.where} AND ${SPIKE_SOURCE_FILTER}`,
          select: "name, type, resourceUrl, COUNT() AS count",
          groupBy: "name, type, resourceUrl",
          orderBy: "count DESC",
          limit: JobsService.TOP_ITEMS_LIMIT,
          queryParams: timeFilter.queryParams,
        });
        if (await this.alertState.shouldFire(key)) {
          this.emitAlert({
            ...base,
            signal: "js-error-spike",
            phase: "firing",
            severity: "high",
            count,
            affectedUsers: markedUsers,
            topItems: topRows.map(
              (row: Record<string, unknown>) =>
                `[${row.type || "Error"}] ${row.name || "Unknown error"} @ ${row.resourceUrl || ""} — ${row.count}`,
            ),
          });
        }
      } else if (await this.alertState.recoverIfClean(key)) {
        this.emitAlert({
          ...base,
          signal: "js-error-spike",
          phase: "recovered",
          severity: "high",
          count: 0,
          affectedUsers: 0,
          topItems: [],
        });
      }
    });

    // First-seen JS errors (Sentry-style new issues): group the window by
    // error fingerprint and alert for fingerprints with no row before the
    // window. A fingerprint that persists is already "known" one minute
    // later, so it never re-alerts. Only runtime sources qualify (ADR-050);
    // the grouping and the baseline share that predicate so console or
    // resource rows can neither alert nor occupy a fingerprint.
    await this.runSignal("js-error-first-seen", async () => {
      const errorModel = await this.clickhouse.WebError(system.appKey);
      const timeFilter = this.buildClickHouseTimeFilter(windowStart, windowEnd);
      const groups = await errorModel.find({
        where: `${timeFilter.where} AND ${FIRST_SEEN_SOURCE_FILTER}`,
        select: "name, resourceUrl, line, type, COUNT() AS count, uniqExactIf(markUser, markUser != '') AS users",
        groupBy: "name, resourceUrl, line, type",
        orderBy: "count DESC",
        limit: JobsService.NEW_ERROR_LIMIT,
        queryParams: timeFilter.queryParams,
      });
      for (const row of groups) {
        const name = String(row.name ?? "Unknown error");
        const resourceUrl = String(row.resourceUrl ?? "");
        const line = String(row.line ?? "");
        const fingerprint = this.errorFingerprint(name, resourceUrl, line);
        const beforeFilter = this.buildClickHouseBeforeFilter(windowStart);
        const existedRows = await errorModel.find({
          where: `${beforeFilter.where} AND ${FIRST_SEEN_SOURCE_FILTER} AND name = {name:String} AND resourceUrl = {resourceUrl:String} AND line = {line:String}`,
          select: "1",
          limit: 1,
          queryParams: { ...beforeFilter.queryParams, name, resourceUrl, line },
        });
        if (existedRows.length > 0) continue;
        // First-seen is an edge detector: a fingerprint fires once and the
        // baseline check prevents re-firing. The cooldown state still applies
        // (defense in depth), but there is no recovered notification — a
        // "new error" signal has no level to recover from. The state key
        // TTL-expires when the fingerprint stops recurring.
        const key = this.alertStateKey(base.appKey, "js-error-first-seen", undefined, fingerprint);
        if (await this.alertState.shouldFire(key)) {
          this.emitAlert({
            ...base,
            signal: "js-error-first-seen",
            phase: "firing",
            severity: "high",
            count: parseInt(String(row.count ?? "0"), 10),
            affectedUsers: parseInt(String(row.users ?? "0"), 10),
            errorName: name,
            resourceUrl,
            fingerprint,
            topItems: [
              `[${row.type || "Error"}] ${name} @ ${resourceUrl || "unknown"}:${line || "?"} ` +
                `— ${row.count} occurrence(s), ${row.users} identified user(s)`,
            ],
          });
        }
      }
    });
  }

  private async runSignal(name: string, evaluate: () => Promise<void>) {
    try {
      await evaluate();
    } catch (error) {
      // One failing signal (e.g. a not-yet-created per-app table) must not
      // suppress the remaining signals for the same system.
      this.logger.warn(`Threshold alert signal "${name}" failed: ${getErrorMessage(error)}`);
    }
  }

  private emitAlert(event: WebThresholdAlertEvent) {
    try {
      this.eventEmitter.emit(WEB_THRESHOLD_ALERT_EVENT, event);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${WEB_THRESHOLD_ALERT_EVENT} for system ${event.appKey} (${event.signal}): ${getErrorMessage(error)}`,
      );
    }
  }

  // ---- Alert lifecycle state machine (ADR-051) ----

  /**
   * State key for one alert identity: appKey + signal, plus optional resource
   * category (slow-resource) and error fingerprint (js-error-first-seen).
   */
  private alertStateKey(
    appKey: string,
    signal: WebThresholdAlertSignal,
    category?: WebThresholdAlertCategory,
    fingerprint?: string,
  ): string {
    let key = `web-monitor:alert-state:${appKey}:${signal}`;
    if (category) key += `:${category}`;
    if (fingerprint) key += `:${fingerprint}`;
    return key;
  }

  private buildClickHouseTimeFilter(
    windowStart: Date,
    windowEnd: Date,
  ): { where: string; queryParams: Record<string, unknown> } {
    return {
      where:
        `createTime >= toDateTime({windowStart:String}, 'Asia/Shanghai') ` +
        `AND createTime < toDateTime({windowEnd:String}, 'Asia/Shanghai')`,
      queryParams: {
        windowStart: this.toShanghaiDateTime(windowStart),
        windowEnd: this.toShanghaiDateTime(windowEnd),
      },
    };
  }

  /** Upper-bound filter for checking whether an error fingerprint existed earlier. */
  private buildClickHouseBeforeFilter(windowStart: Date): { where: string; queryParams: Record<string, unknown> } {
    return {
      where: `createTime < toDateTime({windowStart:String}, 'Asia/Shanghai')`,
      queryParams: { windowStart: this.toShanghaiDateTime(windowStart) },
    };
  }

  /** Compact stable hash (FNV-1a, hex) of an error name/url/line fingerprint. */
  private errorFingerprint(name: string, resourceUrl: string, line: string): string {
    const source = `${name}|${resourceUrl}|${line}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  /** Formats a Date as a ClickHouse datetime literal in Asia/Shanghai (UTC+8). */
  private toShanghaiDateTime(date: Date): string {
    return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }

  /** First non-internal IPv4 address of this host, used as a Redis lock holder tag. */
  private localAddress(): string {
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family === "IPv4" && !info.internal) {
          return info.address;
        }
      }
    }
    return "127.0.0.1";
  }

  private async redisLock(redisKey: string, ttl: number) {
    const lock = `${this.localAddress()}:${func.randomString(3)}`;
    const res = await this.redis.getClient().set(redisKey, lock, "EX", ttl, "NX");
    if (!res) {
      // Lock is held by another instance — normal in multi-instance deployments.
      // Log at verbose level so it doesn't spam the console every minute.
      this.logger.verbose(`Lock [${redisKey}] not acquired (held by another instance)`);
      return false;
    }
    const dbLock = await this.redis.getClient().get(redisKey);
    if (lock !== dbLock) {
      // Lock verification failed — could indicate a race or Redis issue, worth warning.
      this.logger.warn(`Lock [${redisKey}] verification failed: expected ${lock}, got ${dbLock}`);
      return false;
    }
    // Lock acquired successfully — normal event, log at verbose level to avoid noise.
    this.logger.verbose(`Lock [${redisKey}] acquired: ${lock}`);
    return true;
  }

  async updateAppInfoCache() {
    try {
      const systems = await this.site.getSiteList();
      this.nodeCache.updateAllSiteCache(systems);
    } catch (e) {
      this.logger.error("IO error: failed to update cached appKey info", getErrorMessage(e));
    }
  }

  async pvuvipMinuteCount() {
    const getLock = await this.redisLock(
      RedisKeys.PVUVIP_PRE_MINUTE_LOCK,
      WEB_MONITOR_CONFIG.pvuvip_task_minute_lock_time,
    );
    if (!getLock) return;
    await this.webPvuvipTask.getWebPvUvIpByMinute();
  }

  async ipTask() {
    const getLock = await this.redisLock(RedisKeys.IP_TASK_LOCK, WEB_MONITOR_CONFIG.ip_task_lock_time);
    if (!getLock) return;
    await this.webIpTask.saveWebGetIpDatas();
  }

  async dayReportNumTask() {
    const getLock = await this.redisLock(
      RedisKeys.DAY_REPORT_NUM_TASK_LOCK,
      WEB_MONITOR_CONFIG.day_report_num_task_lock_time,
    );
    if (!getLock) return;
    await this.dayReportNum.numCountTask();
  }

  async consumeReportQueues() {
    // Use the cron expression from configuration
    try {
      if (WEB_MONITOR_CONFIG.is_web_consume_task_run) await this.consumeWebQueue();
    } catch (e) {
      this.logger.error("Consumer queue exception", getErrorMessage(e));
    }
    // Can later be split into a standalone cron job if needed
  }

  private async consumeWebQueue() {
    await this.webReportTask.saveWebReportDatasForRedis();
  }
}
