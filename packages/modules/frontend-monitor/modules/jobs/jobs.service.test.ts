import assert from "node:assert/strict";
import { test } from "node:test";

import { JobsService } from "./jobs.service";
import { WEB_THRESHOLD_ALERT_EVENT } from "./threshold-alert.event";
import { RedisKeys } from "../../models/enum";
import { FRONTEND_MONITOR_CONFIG } from "../../shared/frontend-monitor-config";

/**
 * Behavior-level orchestration contract of JobsService: scheduled entry-point
 * lock guards, per-system and per-signal error isolation, and the threshold
 * evaluation -> alert emission shape (incl. the Mongo/ClickHouse query
 * fragments that encode a real contract).
 *
 * Out of scope here (covered by sibling tests): the alert state machine
 * internals (alert-state.test.ts), the shouldFire/recoverIfClean wiring
 * counts (alert-lifecycle.test.ts), and the error-source api predicates
 * (error-source.test.ts).
 */

type Row = Record<string, unknown>;

const SYSTEM: Row = { appKey: "APP1", systemName: "Storefront", type: "web" };

interface RedisOptions {
  configured?: boolean;
  held?: boolean;
  setError?: Error;
  corruptGet?: boolean;
  initial?: Record<string, string>;
}

function fakeRedis(options: RedisOptions = {}) {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}));
  const calls = {
    set: [] as Array<{ key: string; value: string; ttl?: number; mode?: string }>,
    get: [] as string[],
    del: [] as string[],
  };
  const client = {
    async set(key: string, value: string, _expirationMode: string, ttl: number, mode?: string) {
      calls.set.push({ key, value, ttl, mode });
      if (options.setError) throw options.setError;
      if (mode === "NX" && options.held) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key: string) {
      calls.get.push(key);
      if (options.corruptGet) return "corrupted-lock-value";
      return store.get(key) ?? null;
    },
    async del(key: string) {
      calls.del.push(key);
      store.delete(key);
      return 1;
    },
  };
  const redis = {
    isConfigured: () => options.configured ?? true,
    getClient: () => client,
  };
  return { redis, store, calls };
}

interface HarnessOptions {
  redis?: RedisOptions;
  systems?: Row[];
  systemsError?: Error;
  siteListError?: Error;
  pageCount?: number;
  pageRows?: Row[];
  pageFailsFor?: string[];
  resourceCountFor?: (match: Row) => number;
  resourceRows?: Row[];
  ajaxCount?: number;
  ajaxRows?: Row[];
  spikeCount?: number;
  spikeUsers?: number;
  spikeRows?: Row[];
  firstSeenGroups?: Row[];
  firstSeenBaseline?: (queryParams: Row) => Row[];
  emitterError?: Error;
}

function harness(options: HarnessOptions = {}) {
  const { redis, store: redisStore, calls: redisCalls } = fakeRedis(options.redis);

  const events: Array<{ name: string; payload: Row }> = [];
  const eventEmitter = {
    emit: (name: string, payload: Row) => {
      if (options.emitterError) throw options.emitterError;
      events.push({ name, payload });
    },
  };

  const mongoCountCalls: Array<{ kind: string; appKey: string; match: Row }> = [];
  const mongoAggregateCalls: Array<{ kind: string; appKey: string; pipeline: Row[] }> = [];
  const mongoModel = (kind: "page" | "resource", appKey: string) => ({
    countDocuments: async (match: Row) => {
      mongoCountCalls.push({ kind, appKey, match });
      if (kind === "page" && options.pageFailsFor?.includes(appKey)) {
        throw new Error(`collection missing for ${appKey}`);
      }
      if (kind === "page") return options.pageCount ?? 0;
      return options.resourceCountFor ? options.resourceCountFor(match) : 0;
    },
    aggregate: async (pipeline: Row[]) => {
      mongoAggregateCalls.push({ kind, appKey, pipeline });
      return kind === "page" ? (options.pageRows ?? []) : (options.resourceRows ?? []);
    },
  });
  const models = {
    WebPage: (appKey: string) => mongoModel("page", appKey),
    WebResource: (appKey: string) => mongoModel("resource", appKey),
  };

  const ajaxCalls: Row[] = [];
  const errorCalls: Row[] = [];
  const ajaxAppKeys: string[] = [];
  const ajaxModel = {
    find: async (query: Row) => {
      ajaxCalls.push(query);
      if (String(query.select).includes("count() AS total")) return [{ total: String(options.ajaxCount ?? 0) }];
      return options.ajaxRows ?? [];
    },
  };
  const errorModel = {
    find: async (query: Row) => {
      errorCalls.push(query);
      if (query.select === "1") return options.firstSeenBaseline?.((query.queryParams ?? {}) as Row) ?? [];
      if (query.groupBy === "name, resourceUrl, line, type") return options.firstSeenGroups ?? [];
      if (String(query.select).includes("markedUsers")) {
        return [{ total: String(options.spikeCount ?? 0), markedUsers: String(options.spikeUsers ?? 0) }];
      }
      return options.spikeRows ?? [];
    },
  };
  const clickhouse = {
    WebAjax: async (appKey: string) => {
      ajaxAppKeys.push(appKey);
      return ajaxModel;
    },
    WebError: async () => errorModel,
  };

  const siteCalls = { getWebSiteList: 0, getSiteList: 0 };
  const site = {
    getWebSiteList: async () => {
      siteCalls.getWebSiteList += 1;
      if (options.systemsError) throw options.systemsError;
      return options.systems ?? [];
    },
    getSiteList: async () => {
      siteCalls.getSiteList += 1;
      if (options.siteListError) throw options.siteListError;
      return options.systems ?? [];
    },
  };

  const nodeCacheCalls: Row[][] = [];
  const nodeCache = {
    updateAllSiteCache: (systems: Row[]) => {
      nodeCacheCalls.push(systems);
    },
  };

  const dayReportNumCalls = { numCountTask: 0 };
  const dayReportNum = {
    numCountTask: async () => {
      dayReportNumCalls.numCountTask += 1;
    },
  };
  const pvuvipCalls = { count: 0 };
  const webPvuvipTask = {
    getWebPvUvIpByMinute: async () => {
      pvuvipCalls.count += 1;
    },
  };
  const ipCalls = { count: 0 };
  const webIpTask = {
    saveWebGetIpDatas: async () => {
      ipCalls.count += 1;
    },
  };
  const reportDrain = { calls: 0, error: undefined as Error | undefined };
  const webReportTask = {
    saveWebReportDatasForRedis: async () => {
      reportDrain.calls += 1;
      if (reportDrain.error) throw reportDrain.error;
    },
  };

  const scheduledJobs = new Map<string, { isActive: boolean; stop: () => void }>();
  const scheduler = {
    addCronJob: (name: string, job: unknown) => {
      scheduledJobs.set(name, job as { isActive: boolean; stop: () => void });
    },
  };

  const service = new JobsService(
    redis as never,
    site as never,
    nodeCache as never,
    dayReportNum as never,
    scheduler as never,
    webReportTask as never,
    webPvuvipTask as never,
    webIpTask as never,
    models as never,
    clickhouse as never,
    eventEmitter as never,
  );

  return {
    service,
    events,
    redisCalls,
    redisStore,
    siteCalls,
    nodeCacheCalls,
    dayReportNumCalls,
    pvuvipCalls,
    ipCalls,
    reportDrain,
    scheduledJobs,
    mongoCountCalls,
    mongoAggregateCalls,
    ajaxCalls,
    ajaxAppKeys,
    errorCalls,
  };
}

// ---- evaluateThresholdAlerts: entry guards ----

test("evaluateThresholdAlerts is a no-op while another instance holds the lock", async () => {
  const h = harness({ redis: { held: true }, systems: [SYSTEM], pageCount: 5 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.siteCalls.getWebSiteList, 0, "the system list must not even load without the lock");
  assert.equal(h.events.length, 0);
});

test("evaluateThresholdAlerts takes the alert lock with the configured ttl", async () => {
  const h = harness({ systems: [] });
  await h.service.evaluateThresholdAlerts();
  const lockWrite = h.redisCalls.set.find((call) => call.mode === "NX");
  assert.equal(lockWrite?.key, RedisKeys.ALERT_EVALUATION_TASK_LOCK);
  assert.equal(lockWrite?.ttl, FRONTEND_MONITOR_CONFIG.alertTaskLockTime);
});

test("evaluateThresholdAlerts runs lock-free when Redis is not configured", async () => {
  const h = harness({ redis: { configured: false }, systems: [SYSTEM], pageCount: 2 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(
    h.redisCalls.set.filter((call) => call.mode === "NX").length,
    0,
    "an unconfigured Redis must not see a lock attempt",
  );
  assert.ok(
    h.events.some((event) => event.payload.signal === "slow-page"),
    "evaluation still runs (fail-open)",
  );
});

test("evaluateThresholdAlerts proceeds lock-free when the lock acquisition throws", async () => {
  const h = harness({ redis: { setError: new Error("redis down") }, systems: [SYSTEM], pageCount: 2 });
  await h.service.evaluateThresholdAlerts();
  assert.ok(h.events.some((event) => event.payload.signal === "slow-page"));
});

test("evaluateThresholdAlerts aborts when the lock verification mismatches", async () => {
  const h = harness({ redis: { corruptGet: true }, systems: [SYSTEM], pageCount: 5 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.siteCalls.getWebSiteList, 0);
  assert.equal(h.events.length, 0);
});

test("evaluateThresholdAlerts returns quietly when the system list cannot be loaded", async () => {
  const h = harness({ systemsError: new Error("mongo down"), pageCount: 5 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.events.length, 0);
  assert.equal(h.mongoCountCalls.length, 0);
});

test("systems without an appKey are skipped", async () => {
  const h = harness({ systems: [{ systemName: "no key", type: "web" }, SYSTEM], pageCount: 2 });
  await h.service.evaluateThresholdAlerts();
  assert.ok(h.mongoCountCalls.every((call) => call.appKey === "APP1"));
  assert.ok(h.events.every((event) => event.payload.appKey === "APP1"));
});

// ---- evaluateThresholdAlerts: error isolation ----

test("a failing signal does not suppress the remaining signals of the same system", async () => {
  const h = harness({
    systems: [SYSTEM],
    pageFailsFor: ["APP1"],
    spikeCount: 12,
    spikeUsers: 5,
    spikeRows: [{ name: "TypeError: boom", type: "onerror", resourceUrl: "https://x/app.js", count: "9" }],
  });
  await h.service.evaluateThresholdAlerts();
  const spike = h.events.find((event) => event.payload.signal === "js-error-spike");
  assert.ok(spike, "the spike signal must still fire when the page signals fail");
});

test("a failing system does not abort the evaluation of the other systems", async () => {
  const h = harness({
    systems: [
      { appKey: "BROKEN", type: "web" },
      { appKey: "APP2", type: "web" },
    ],
    pageFailsFor: ["BROKEN"],
    pageCount: 2,
  });
  await h.service.evaluateThresholdAlerts();
  assert.ok(
    h.events.some((event) => event.payload.appKey === "APP2" && event.payload.signal === "slow-page"),
    "the healthy system must still be evaluated",
  );
  assert.ok(h.ajaxAppKeys.includes("BROKEN"), "the failing system's later ClickHouse signals still run");
});

test("a throwing event subscriber does not abort the evaluation", async () => {
  const h = harness({ systems: [SYSTEM], pageCount: 2, emitterError: new Error("subscriber down") });
  await h.service.evaluateThresholdAlerts();
});

// ---- slow-page signal ----

test("a breached slow-page threshold emits the firing event with top offenders", async () => {
  const h = harness({
    systems: [{ appKey: "APP1", slowPageTime: 3, type: "web" }],
    pageCount: 5,
    pageRows: [{ _id: "/home", count: 3, maxLoadTime: 4200 }],
  });
  await h.service.evaluateThresholdAlerts();
  const event = h.events.find((candidate) => candidate.payload.signal === "slow-page");
  assert.ok(event);
  assert.equal(event.name, WEB_THRESHOLD_ALERT_EVENT);
  assert.equal(WEB_THRESHOLD_ALERT_EVENT, "frontend-monitor.threshold-alert");
  const payload = event.payload;
  assert.equal(payload.appKey, "APP1");
  assert.equal(payload.systemName, "APP1", "a missing systemName falls back to the appKey");
  assert.equal(payload.phase, "firing");
  assert.equal(payload.severity, "medium");
  assert.equal(payload.count, 5);
  assert.equal(payload.thresholdMs, 3000);
  assert.equal(payload.windowMs, FRONTEND_MONITOR_CONFIG.alertWindowMs);
  assert.equal(typeof payload.windowStartedAt, "string");
  assert.deepEqual(payload.topItems, ["/home — 3 load(s), max 4200ms"]);
});

test("a slow-page count below the minimum breach count does not fire", async () => {
  const h = harness({ systems: [SYSTEM], pageCount: 1 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.events.length, 0);
});

test("slow-page queries Mongo inside the evaluation window with the slow speedType", async () => {
  const h = harness({ systems: [SYSTEM] });
  await h.service.evaluateThresholdAlerts();
  const slowPage = h.mongoCountCalls.find((call) => call.kind === "page");
  assert.ok(slowPage);
  const match = slowPage.match as { createTime: { $gte: Date; $lt: Date }; speedType: number };
  assert.equal(match.speedType, 2);
  assert.ok(match.createTime.$gte instanceof Date && match.createTime.$lt instanceof Date);
  assert.equal(match.createTime.$lt.getTime() - match.createTime.$gte.getTime(), FRONTEND_MONITOR_CONFIG.alertWindowMs);
  const aggregate = h.mongoAggregateCalls.find((call) => call.kind === "page");
  assert.deepEqual(aggregate?.pipeline.at(-1), { $limit: 3 }, "top offenders are capped");
});

test("slow first paints use the per-system whiteTime threshold", async () => {
  const h = harness({ systems: [{ appKey: "APP1", slowWhiteTime: 7, type: "web" }] });
  await h.service.evaluateThresholdAlerts();
  const firstPaint = h.mongoCountCalls.filter((call) => call.kind === "page")[1];
  assert.ok(firstPaint);
  const match = firstPaint.match as { whiteTime: { $gte: number } };
  assert.equal(match.whiteTime.$gte, 7000);
});

test("each slow-resource category is evaluated with its own type filter", async () => {
  const h = harness({
    systems: [SYSTEM],
    resourceCountFor: (match) => ((match.type as { $in: string[] }).$in.includes("script") ? 3 : 0),
    resourceRows: [{ _id: "app.js", count: 3, maxDuration: 2400 }],
  });
  await h.service.evaluateThresholdAlerts();
  const filters = h.mongoCountCalls
    .filter((call) => call.kind === "resource")
    .map((call) => (call.match.type as { $in: string[] }).$in);
  assert.deepEqual(filters, [["script"], ["link", "css"], ["img"]]);
  const fired = h.events.filter((event) => event.payload.signal === "slow-resource");
  assert.equal(fired.length, 1, "only the breaching category fires");
  assert.equal(fired[0].payload.category, "js");
  assert.equal(fired[0].payload.thresholdMs, 2000, "the default slowJsTime is 2s");
  assert.deepEqual(fired[0].payload.topItems, ["app.js — 3 load(s), max 2400ms"]);
});

// ---- ClickHouse signals ----

test("slow ajax fires with a parameterized ClickHouse duration threshold", async () => {
  const h = harness({
    systems: [{ appKey: "APP1", slowAjaxTime: 4, type: "web" }],
    ajaxCount: 5,
    ajaxRows: [{ url: "/api/list", count: "4", maxDuration: "5300" }],
  });
  await h.service.evaluateThresholdAlerts();
  const countQuery = h.ajaxCalls[0];
  assert.equal(countQuery.select, "count() AS total");
  assert.match(String(countQuery.where), /duration >= \{thresholdMs:UInt32\}/);
  assert.match(String(countQuery.where), /createTime >= toDateTime\(\{windowStart:String\}, 'Asia\/Shanghai'\)/);
  assert.equal((countQuery.queryParams as Row).thresholdMs, 4000, "thresholds stay out of the SQL text");
  const topQuery = h.ajaxCalls[1];
  assert.equal(topQuery.groupBy, "url");
  assert.equal(topQuery.limit, 3);
  const event = h.events.find((candidate) => candidate.payload.signal === "slow-ajax");
  assert.ok(event);
  assert.equal(event.payload.count, 5);
  assert.equal(event.payload.thresholdMs, 4000);
  assert.deepEqual(event.payload.topItems, ["/api/list — 4 call(s), max 5300ms"]);
});

test("the js-error-spike gate requires enough distinct identified visitors", async () => {
  const h = harness({ systems: [SYSTEM], spikeCount: 12, spikeUsers: 1 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.events.filter((event) => event.payload.signal === "js-error-spike").length, 0);
  assert.equal(
    h.errorCalls.filter((query) => query.groupBy === "name, type, resourceUrl").length,
    0,
    "the top-items query must not run when the gate fails",
  );
});

test("js-error-spike fires for anonymous-only traffic", async () => {
  const h = harness({ systems: [SYSTEM], spikeCount: 12, spikeUsers: 0 });
  await h.service.evaluateThresholdAlerts();
  const event = h.events.find((candidate) => candidate.payload.signal === "js-error-spike");
  assert.ok(event, "no identifiable visitor means the user gate cannot apply");
  assert.equal(event.payload.affectedUsers, 0);
});

test("js-error-spike fires with affected users when both gates pass", async () => {
  const h = harness({
    systems: [SYSTEM],
    spikeCount: 12,
    spikeUsers: 3,
    spikeRows: [{ name: "TypeError: boom", type: "onerror", resourceUrl: "https://x/app.js", count: "9" }],
  });
  await h.service.evaluateThresholdAlerts();
  const event = h.events.find((candidate) => candidate.payload.signal === "js-error-spike");
  assert.ok(event);
  assert.equal(event.payload.severity, "high");
  assert.equal(event.payload.count, 12);
  assert.equal(event.payload.affectedUsers, 3);
  assert.deepEqual(event.payload.topItems, ["[onerror] TypeError: boom @ https://x/app.js — 9"]);
});

test("js-error-first-seen fires only for fingerprints without history", async () => {
  const fresh = {
    name: "TypeError: boom",
    resourceUrl: "https://x/app.js",
    line: "12",
    type: "onerror",
    count: "4",
    users: "2",
  };
  const known = {
    name: "RangeError: old",
    resourceUrl: "https://x/old.js",
    line: "3",
    type: "onerror",
    count: "1",
    users: "1",
  };
  const h = harness({
    systems: [SYSTEM],
    firstSeenGroups: [fresh, known],
    firstSeenBaseline: (params) => (params.name === fresh.name ? [] : [{ "1": 1 }]),
  });
  await h.service.evaluateThresholdAlerts();
  const baselineProbes = h.errorCalls.filter((query) => query.select === "1");
  assert.equal(baselineProbes.length, 2, "each group gets one history probe");
  assert.match(String(baselineProbes[0].where), /createTime < toDateTime\(\{windowStart:String\}, 'Asia\/Shanghai'\)/);
  const fired = h.events.filter((event) => event.payload.signal === "js-error-first-seen");
  assert.equal(fired.length, 1, "the fingerprint with prior history must not re-alert");
  const payload = fired[0].payload;
  assert.equal(payload.errorName, fresh.name);
  assert.equal(payload.resourceUrl, fresh.resourceUrl);
  assert.equal(payload.count, 4);
  assert.equal(payload.affectedUsers, 2);
  assert.equal(payload.severity, "high");
  assert.match(String(payload.fingerprint), /^[0-9a-f]{8}$/);
});

// ---- lifecycle: recovery across ticks ----

test("a clean signal recovers after the configured number of consecutive clean windows", async () => {
  const stateKey = "frontend-monitor:alert-state:APP1:slow-page";
  const firing = JSON.stringify({
    status: "firing",
    firstFiredAt: new Date().toISOString(),
    lastFiredAt: new Date().toISOString(),
    cleanWindows: 0,
  });
  const h = harness({ redis: { initial: { [stateKey]: firing } }, systems: [SYSTEM], pageCount: 0 });
  await h.service.evaluateThresholdAlerts();
  assert.equal(h.events.length, 0, "the first clean window only advances the counter");
  await h.service.evaluateThresholdAlerts();
  const recovered = h.events.filter((event) => event.payload.signal === "slow-page");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].payload.phase, "recovered");
  assert.equal(recovered[0].payload.count, 0);
  assert.deepEqual(recovered[0].payload.topItems, []);
  assert.equal(h.redisStore.has(stateKey), false, "recovery clears the state key");
});

// ---- other scheduled entry points ----

test("pvuvipMinuteCount runs the task only while holding its lock", async () => {
  const locked = harness({ redis: { held: true } });
  await locked.service.pvuvipMinuteCount();
  assert.equal(locked.pvuvipCalls.count, 0);
  const free = harness();
  await free.service.pvuvipMinuteCount();
  assert.equal(free.pvuvipCalls.count, 1);
  const lockWrite = free.redisCalls.set.find((call) => call.mode === "NX");
  assert.equal(lockWrite?.key, RedisKeys.PVUVIP_PRE_MINUTE_LOCK);
  assert.equal(lockWrite?.ttl, FRONTEND_MONITOR_CONFIG.pvuvip_task_minute_lock_time);
});

test("ipTask runs the task only while holding its lock", async () => {
  const locked = harness({ redis: { held: true } });
  await locked.service.ipTask();
  assert.equal(locked.ipCalls.count, 0);
  const free = harness();
  await free.service.ipTask();
  assert.equal(free.ipCalls.count, 1);
  const lockWrite = free.redisCalls.set.find((call) => call.mode === "NX");
  assert.equal(lockWrite?.key, RedisKeys.IP_TASK_LOCK);
  assert.equal(lockWrite?.ttl, FRONTEND_MONITOR_CONFIG.ip_task_lock_time);
});

test("dayReportNumTask runs the task only while holding its lock", async () => {
  const locked = harness({ redis: { held: true } });
  await locked.service.dayReportNumTask();
  assert.equal(locked.dayReportNumCalls.numCountTask, 0);
  const free = harness();
  await free.service.dayReportNumTask();
  assert.equal(free.dayReportNumCalls.numCountTask, 1);
  const lockWrite = free.redisCalls.set.find((call) => call.mode === "NX");
  assert.equal(lockWrite?.key, RedisKeys.DAY_REPORT_NUM_TASK_LOCK);
  assert.equal(lockWrite?.ttl, FRONTEND_MONITOR_CONFIG.day_report_num_task_lock_time);
});

test("updateAppInfoCache rebuilds the site cache and swallows load failures", async () => {
  const healthy = harness({ systems: [SYSTEM] });
  await healthy.service.updateAppInfoCache();
  assert.deepEqual(healthy.nodeCacheCalls, [[SYSTEM]]);
  const failing = harness({ siteListError: new Error("mongo down") });
  await failing.service.updateAppInfoCache();
  assert.equal(failing.nodeCacheCalls.length, 0, "a failed load must not touch the cache");
});

test("consumeReportQueues drains the web queue and isolates drain failures", async () => {
  const healthy = harness();
  await healthy.service.consumeReportQueues();
  assert.equal(healthy.reportDrain.calls, 1);
  const failing = harness();
  failing.reportDrain.error = new Error("drain down");
  await failing.service.consumeReportQueues();
  assert.equal(failing.reportDrain.calls, 1, "the drain ran and its failure was contained");
});

test("onModuleInit registers and starts the report-queue consumer cron", async () => {
  const h = harness();
  await h.service.onModuleInit();
  const job = h.scheduledJobs.get("consumeReportQueues");
  assert.ok(job, "the consumer cron must be registered under consumeReportQueues");
  assert.equal(job.isActive, true, "the cron starts immediately");
  job.stop();
  assert.equal(job.isActive, false);
});
