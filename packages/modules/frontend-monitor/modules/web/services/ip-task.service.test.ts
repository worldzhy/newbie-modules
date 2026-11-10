import assert from "node:assert/strict";
import { test } from "node:test";

import { RedisKeyPrefix } from "../../../models/enum";
import { WEB_MONITOR_CONFIG } from "../../../shared/frontend-monitor-config";
import { WebIpTaskService } from "./ip-task.service";

/**
 * Orchestration contracts for WebIpTaskService: each web site is scanned for
 * environment rows without a city, the scan resumes from a Redis checkpoint
 * (or ip_task_space_time in the past), geo lookups are cached per /24 under
 * the IP_GEO_CACHE prefix, and a processed batch advances the checkpoint to
 * the last row's createTime. The Tencent fetch itself needs network and is
 * covered only up to its skip conditions.
 */

const APP_KEY = "app1";
const BEGIN_KEY = `${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${APP_KEY}`;

interface EnvDoc {
  ip: string;
  _id: string;
  appKey: string;
  createTime: Date;
}

function doc(ip: string, id: string, createTime: Date): EnvDoc {
  return { ip, _id: id, appKey: APP_KEY, createTime };
}

function fakeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const gets: string[] = [];
  const sets: { key: string; value: string; extra: unknown[] }[] = [];
  const client = {
    async get(key: string) {
      gets.push(key);
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ...extra: unknown[]) {
      sets.push({ key, value, extra });
      store.set(key, value);
      return "OK";
    },
  };
  return { redis: { getClient: () => client }, store, gets, sets };
}

function fakeModels(docs: EnvDoc[], opts: { findError?: Error } = {}) {
  const findQueries: Record<string, unknown>[] = [];
  const chain: { limit?: number; sort?: unknown; readMode?: string } = {};
  const updates: { filter: unknown; update: unknown; options: unknown }[] = [];
  const appKeys: string[] = [];
  const models = {
    WebEnvironment: (appKey: string) => {
      appKeys.push(appKey);
      return {
        find(query: Record<string, unknown>) {
          findQueries.push(query);
          const q: Record<string, unknown> = {};
          q.read = (mode: string) => {
            chain.readMode = mode;
            return q;
          };
          q.limit = (n: number) => {
            chain.limit = n;
            return q;
          };
          q.sort = (s: unknown) => {
            chain.sort = s;
            return q;
          };
          q.exec = async () => {
            if (opts.findError) throw opts.findError;
            return docs;
          };
          return q;
        },
        updateOne(filter: unknown, update: unknown, options: unknown) {
          updates.push({ filter, update, options });
          return { exec: async () => ({ acknowledged: true }) };
        },
      };
    },
  };
  return { models, findQueries, chain, updates, appKeys };
}

function buildService(
  opts: {
    systems?: { appKey?: string }[];
    docs?: EnvDoc[];
    redisInitial?: Record<string, string>;
    config?: Record<string, unknown>;
    findError?: Error;
  } = {},
) {
  const redis = fakeRedis(opts.redisInitial);
  const store = fakeModels(opts.docs ?? [], { findError: opts.findError });
  const site = { getWebSiteList: async () => opts.systems ?? [] };
  const config = { get: () => opts.config ?? {} };
  const service = new WebIpTaskService(config as never, store.models as never, redis.redis as never, site as never);
  (service as unknown as { logger: unknown }).logger = { error: () => {} };
  return { service, redis, store };
}

test("no web sites means no repository or Redis work", async () => {
  const { service, redis, store } = buildService({ systems: [] });
  await service.saveWebGetIpDatas();
  assert.equal(redis.gets.length, 0);
  assert.equal(store.findQueries.length, 0);
});

test("systems without an appKey are skipped, the rest are scanned per appKey", async () => {
  const { service, store } = buildService({ systems: [{}, { appKey: APP_KEY }] });
  await service.saveWebGetIpDatas();
  assert.equal(store.findQueries.length, 1);
  assert.deepEqual(store.appKeys, [APP_KEY]);
});

test("the scan only asks for rows without a city, oldest first, bounded by ip_thread", async () => {
  const { service, store } = buildService({ systems: [{ appKey: APP_KEY }] });
  await service.saveWebGetIpDatas();
  assert.deepEqual(store.findQueries[0].city, { $exists: false });
  assert.equal(store.chain.limit, WEB_MONITOR_CONFIG.ip_thread * 60);
  assert.deepEqual(store.chain.sort, { createTime: 1 });
  assert.equal(store.chain.readMode, "secondaryPreferred");
});

test("without a stored checkpoint the scan starts ip_task_space_time in the past", async () => {
  const { service, store } = buildService({ systems: [{ appKey: APP_KEY }] });
  const before = Date.now() - WEB_MONITOR_CONFIG.ip_task_space_time;
  await service.saveWebGetIpDatas();
  const after = Date.now() - WEB_MONITOR_CONFIG.ip_task_space_time;
  const gt = (store.findQueries[0].createTime as { $gt: Date }).$gt;
  assert.ok(
    gt.getTime() >= before && gt.getTime() <= after,
    "the fallback lower bound must track the configured window",
  );
});

test("a stored checkpoint is reused as the exclusive lower bound", async () => {
  const checkpoint = new Date("2026-01-01T00:00:00.000Z");
  const { service, store } = buildService({
    systems: [{ appKey: APP_KEY }],
    redisInitial: { [BEGIN_KEY]: checkpoint.toISOString() },
  });
  await service.saveWebGetIpDatas();
  assert.deepEqual((store.findQueries[0].createTime as { $gt: Date }).$gt, checkpoint);
});

test("an idle scan advances the checkpoint to now so the next run does not rescan", async () => {
  const { service, redis } = buildService({ systems: [{ appKey: APP_KEY }] });
  const before = Date.now();
  await service.saveWebGetIpDatas();
  const value = redis.store.get(BEGIN_KEY);
  assert.ok(value, "an empty batch must still move the checkpoint forward");
  // The stored value is `new Date().toString()`, which carries only second
  // precision — parsing it back can land up to 999ms before `before`.
  const time = new Date(value as string).getTime();
  assert.ok(!Number.isNaN(time), "the checkpoint must stay parseable by `new Date` on the next run");
  assert.ok(time >= before - 1000 && time <= Date.now());
});

test("a processed batch advances the checkpoint to the last row createTime", async () => {
  const d1 = new Date("2026-02-01T00:00:00.000Z");
  const d2 = new Date("2026-02-01T00:01:00.000Z");
  const { service, redis } = buildService({
    systems: [{ appKey: APP_KEY }],
    docs: [doc("9.9.9.9", "a", d1), doc("8.8.8.8", "b", d2)],
  });
  await service.saveWebGetIpDatas();
  assert.equal(redis.store.get(BEGIN_KEY), String(d2));
});

test("a cached geo entry updates the row without an API call", async () => {
  const cached = { _ip: "1.2.3.4", province: "P", city: "C" };
  const { service, redis, store } = buildService({
    systems: [{ appKey: APP_KEY }],
    docs: [doc("1.2.3.4", "doc1", new Date("2026-02-01T00:00:00.000Z"))],
    redisInitial: { [`${RedisKeyPrefix.IP_GEO_CACHE}1.2.3`]: JSON.stringify(cached) },
  });
  await service.saveWebGetIpDatas();
  assert.deepEqual(store.updates, [
    { filter: { _id: "doc1" }, update: { $set: { province: "P", city: "C" } }, options: { upsert: true } },
  ]);
  assert.ok(
    redis.sets.every((s) => !s.key.startsWith(RedisKeyPrefix.IP_GEO_CACHE)),
    "a cache hit must not rewrite the geo cache",
  );
});

test("the geo cache key is the /24 prefix of the client ip", async () => {
  const { service, redis, store } = buildService({
    systems: [{ appKey: APP_KEY }],
    docs: [doc("10.20.30.40", "doc1", new Date("2026-02-01T00:00:00.000Z"))],
  });
  await service.saveWebGetIpDatas();
  assert.ok(redis.gets.includes(`${RedisKeyPrefix.IP_GEO_CACHE}10.20.30`));
  assert.equal(store.updates.length, 0, "without a TENCENTMAPKEY the lookup must stop after the cache miss");
});

test("a corrupt cache entry falls through to the fetch path instead of throwing", async () => {
  const { service, store } = buildService({
    systems: [{ appKey: APP_KEY }],
    docs: [doc("10.20.30.40", "doc1", new Date("2026-02-01T00:00:00.000Z"))],
    redisInitial: { [`${RedisKeyPrefix.IP_GEO_CACHE}10.20.30`]: "not-json{{" },
  });
  await service.saveWebGetIpDatas();
  assert.equal(store.updates.length, 0, "the corrupt entry must not be applied to the row");
});

test("skip-list ips are never looked up or written even with a key configured", async () => {
  const { service, redis, store } = buildService({
    systems: [{ appKey: APP_KEY }],
    docs: [doc("127.0.0.1", "doc1", new Date("2026-02-01T00:00:00.000Z"))],
    config: { TENCENTMAPKEY: "key" },
  });
  await service.saveWebGetIpDatas();
  assert.ok(redis.gets.includes(`${RedisKeyPrefix.IP_GEO_CACHE}127.0.0`));
  assert.equal(store.updates.length, 0);
  assert.ok(redis.sets.every((s) => !s.key.startsWith(RedisKeyPrefix.IP_GEO_CACHE)));
});

test("a repository failure is logged and swallowed so the lock can release", async () => {
  const { service } = buildService({ systems: [{ appKey: APP_KEY }], findError: new Error("mongo down") });
  await service.saveWebGetIpDatas();
});
