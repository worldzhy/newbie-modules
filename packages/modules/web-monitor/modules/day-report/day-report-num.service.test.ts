import assert from "node:assert/strict";
import { test } from "node:test";

import { DayReportNumService } from "./day-report-num.service";
import { func } from "../../shared/utils";
import { RedisKeyPrefix } from "../../models/enum";

/**
 * Redis counter contract of DayReportNumService: one INCR key per appKey per
 * local day (`web-monitor:DayReportNum_<appKey>_<localMidnightMs>`), no
 * explicit expiry — the daily numCountTask folds yesterday's counter into the
 * DayReportNum Mongo collection and deletes the key.
 */

type Row = Record<string, unknown>;

class FakeDayReportDoc {
  appKey?: string;
  type?: string;
  dayTime?: Date;
  createTime?: Date;
  num?: number;
}

function harness(options: { apps?: Row[]; initial?: Record<string, string>; dayRow?: Row } = {}) {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}));
  const redisCalls = { get: [] as string[], del: [] as string[], incr: [] as string[] };
  const client = {
    async get(key: string) {
      redisCalls.get.push(key);
      return store.get(key) ?? null;
    },
    async del(key: string) {
      redisCalls.del.push(key);
      store.delete(key);
      return 1;
    },
    async incr(key: string) {
      redisCalls.incr.push(key);
      const next = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(next));
      return next;
    },
  };
  const redis = { getClient: () => client };

  const saved: FakeDayReportDoc[] = [];
  const DayModel = class extends FakeDayReportDoc {
    async save() {
      saved.push(this);
      return this;
    }
  };

  const readModes: string[] = [];
  const findOneCalls: Array<{ query: Row; projection: Row }> = [];
  // numCountTask news up the returned model; getDayFromMongo calls .findOne
  // on it. DayReportNum() must therefore RETURN a constructor that also
  // carries the query surface — the class itself is never invoked directly.
  const DayModelWithQuery = Object.assign(DayModel, {
    findOne: (query: Row, projection: Row) => {
      findOneCalls.push({ query, projection });
      return {
        read: (mode: string) => {
          readModes.push(mode);
          return { exec: async () => options.dayRow ?? null };
        },
      };
    },
  });
  const models = {
    System: () => ({
      find: () => ({
        read: (mode: string) => {
          readModes.push(mode);
          return { exec: async () => options.apps ?? [] };
        },
      }),
    }),
    DayReportNum: () => DayModelWithQuery,
  };

  const configService = { get: () => ({}) };
  const service = new DayReportNumService(models as never, redis as never, configService as never);
  return { service, store, redisCalls, saved, readModes, findOneCalls };
}

test("redisCount increments the current-day counter key for the appKey", async () => {
  const expectedToday = new Date(func.format(new Date(), "yyyy/MM/dd")).getTime();
  const h = harness();
  await h.service.redisCount("APP1");
  assert.deepEqual(h.redisCalls.incr, [`${RedisKeyPrefix.DAY_REPORT_NUM}APP1_${expectedToday}`]);
  // The counter carries no explicit expiry; numCountTask deletes it after folding.
});

test("getTodayFromRedis reads back the raw counter under the same key shape", async () => {
  const today = 1762531200000;
  const key = `${RedisKeyPrefix.DAY_REPORT_NUM}APP1_${today}`;
  const h = harness({ initial: { [key]: "17" } });
  assert.equal(await h.service.getTodayFromRedis("APP1", today), "17");
  assert.deepEqual(h.redisCalls.get, [key]);
});

test("numCountTask folds yesterday's counters into Mongo and clears them", async () => {
  const expectedYesterday = new Date(func.format(new Date(Date.now() - 86400000), "yyyy/MM/dd")).getTime();
  const keyFor = (appKey: string) => `${RedisKeyPrefix.DAY_REPORT_NUM}${appKey}_${expectedYesterday}`;
  const h = harness({
    apps: [
      { appKey: "APP1", type: "web" },
      { appKey: "APP2", type: "web" },
      { appKey: "APP3", type: "web" },
    ],
    initial: { [keyFor("APP1")]: "5", [keyFor("APP3")]: "9" },
  });
  await h.service.numCountTask();
  assert.deepEqual(h.readModes, ["secondaryPreferred"], "the system list reads from a secondary");
  assert.equal(h.saved.length, 2, "apps without a counter are skipped entirely");
  const first = h.saved.find((doc) => doc.appKey === "APP1");
  assert.ok(first);
  assert.equal(first.num, 5, "the redis string is folded as a number");
  assert.equal(first.type, "web");
  assert.equal(first.dayTime?.getTime(), expectedYesterday, "the row is attributed to yesterday's local midnight");
  assert.ok(first.createTime instanceof Date);
  assert.deepEqual(
    [...h.redisCalls.del].sort(),
    [keyFor("APP1"), keyFor("APP3")].sort(),
    "only folded counters are deleted",
  );
  assert.equal(h.store.has(keyFor("APP1")), false);
  assert.equal(h.redisCalls.get.includes(keyFor("APP2")), true, "every app key is probed");
});

test("getDayFromMongo queries the day range with a minimal projection", async () => {
  const h = harness({ dayRow: { num: 5, dayTime: new Date("2026-11-03 00:00:00") } });
  const row = (await h.service.getDayFromMongo("APP1", "2026-11-01", "2026-11-09")) as unknown as Row;
  assert.equal(row.num, 5);
  assert.deepEqual(h.readModes, ["secondaryPreferred"]);
  assert.equal(h.findOneCalls.length, 1);
  const { query, projection } = h.findOneCalls[0];
  const typed = query as { appKey: string; dayTime: { $gte: Date; $lte: Date } };
  assert.equal(typed.appKey, "APP1");
  assert.equal(typed.dayTime.$gte.getTime(), new Date("2026-11-01 00:00:00").getTime());
  assert.equal(typed.dayTime.$lte.getTime(), new Date("2026-11-09 23:59:59").getTime());
  assert.deepEqual(projection, { num: 1, dayTime: 1 });
});
