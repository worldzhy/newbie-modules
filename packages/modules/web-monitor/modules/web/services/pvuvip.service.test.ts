import assert from "node:assert/strict";
import { test } from "node:test";

import { func } from "../../../shared/utils";
import { PvuvipService } from "./pvuvip.service";

/**
 * Read-side contracts for PvuvipService: the static WebPvUvIp collection is
 * scoped by an appKey filter (not by collection name), day ranges are bucketed
 * to local 00:00:00/23:59:59 boundaries, surveys default missing aggregates
 * to 0, and persisted rows coerce numerics and derive bounce rate / depth.
 */

type Filter = Record<string, unknown>;
type Pipeline = Record<string, unknown>[];

const APP_KEY = "app1";

function fluentQuery(result: unknown, captured: Record<string, unknown> = {}) {
  const q: Record<string, unknown> = {};
  for (const method of ["read", "sort", "limit", "skip"]) {
    q[method] = (value: unknown) => {
      captured[method] = value;
      return q;
    };
  }
  q.exec = async () => result;
  return q;
}

function fakePvuvipModel(opts: { findRows?: unknown[]; findOneRow?: unknown }) {
  const saved: Filter[] = [];
  const findCalls: { filter: Filter; captured: Record<string, unknown> }[] = [];
  const findOneCalls: { filter: Filter; captured: Record<string, unknown> }[] = [];
  class FakePvuvip {
    [key: string]: unknown;
    async save() {
      saved.push({ ...this });
      return this;
    }
    static find(filter: Filter) {
      const captured: Record<string, unknown> = {};
      findCalls.push({ filter, captured });
      return fluentQuery(opts.findRows ?? [], captured);
    }
    static findOne(filter: Filter) {
      const captured: Record<string, unknown> = {};
      findOneCalls.push({ filter, captured });
      return fluentQuery(opts.findOneRow ?? null, captured);
    }
  }
  return { FakePvuvip, saved, findCalls, findOneCalls };
}

function buildService(
  opts: {
    findRows?: unknown[];
    findOneRow?: unknown;
    pvCount?: number;
    envAggRows?: unknown[];
    chRows?: unknown[];
    dayNum?: unknown;
    todayNum?: unknown;
  } = {},
) {
  const pv = fakePvuvipModel(opts);
  const pageCounts: { appKey: string; query: Filter }[] = [];
  const envAggs: { appKey: string; pipeline: Pipeline; readMode?: string }[] = [];
  const chFinds: { appKey: string; query: { select: string; where: string; queryParams: Filter } }[] = [];
  const mongoCalls: { appKey: string; begin: unknown; end: unknown }[] = [];
  const redisCalls: { appKey: string; today: number }[] = [];
  const models = {
    WebPage: (appKey: string) => ({
      count: (query: Filter) => {
        pageCounts.push({ appKey, query });
        return fluentQuery(opts.pvCount ?? 0);
      },
    }),
    WebEnvironment: (appKey: string) => ({
      aggregate: (pipeline: Pipeline) => {
        const call: { appKey: string; pipeline: Pipeline; readMode?: string } = { appKey, pipeline };
        envAggs.push(call);
        return {
          read(mode: string) {
            call.readMode = mode;
            return { exec: async () => opts.envAggRows ?? [] };
          },
        };
      },
    }),
    WebPvuvip: () => pv.FakePvuvip,
  };
  const ch = {
    WebAjax: async (appKey: string) => ({
      find: async (query: { select: string; where: string; queryParams: Filter }) => {
        chFinds.push({ appKey, query });
        return opts.chRows ?? [];
      },
    }),
  };
  const dayReportNum = {
    getDayFromMongo: async (appKey: string, begin: unknown, end: unknown) => {
      mongoCalls.push({ appKey, begin, end });
      return opts.dayNum === undefined ? { num: 7 } : opts.dayNum;
    },
    getTodayFromRedis: async (appKey: string, today: number) => {
      redisCalls.push({ appKey, today });
      return opts.todayNum ?? null;
    },
  };
  const service = new PvuvipService(models as never, ch as never, dayReportNum as never);
  return { service, pv, pageCounts, envAggs, chFinds, mongoCalls, redisCalls };
}

test("getPvUvIpData scopes the static collection by appKey, type 1, and the time range", async () => {
  const { service, pv } = buildService();
  const begin = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-01-02T00:00:00.000Z");
  await service.getPvUvIpData(APP_KEY, begin, end);
  assert.deepEqual(pv.findCalls[0].filter, { appKey: APP_KEY, type: 1, createTime: { $gte: begin, $lte: end } });
  assert.equal(pv.findCalls[0].captured.read, "secondaryPreferred");
});

test("getHistoryPvUvIplist reads the last 5 daily rows and joins the day-report num", async () => {
  const createTime = new Date("2026-01-01T00:00:00.000Z");
  const rows = [
    { appKey: APP_KEY, createTime, pv: 5 },
    { appKey: APP_KEY, pv: 6 },
  ];
  const { service, pv, mongoCalls } = buildService({ findRows: rows, dayNum: { num: 11 } });
  const result = await service.getHistoryPvUvIplist(APP_KEY);
  assert.deepEqual(pv.findCalls[0].filter, { appKey: APP_KEY, type: 2 });
  assert.deepEqual(pv.findCalls[0].captured.sort, { createTime: -1 });
  assert.equal(pv.findCalls[0].captured.limit, 5);
  assert.equal(result[0].num, 11);
  assert.ok(!("num" in result[1]), "a row without createTime must not trigger a day-report lookup");
  assert.equal(mongoCalls.length, 1);
  assert.deepEqual(mongoCalls[0], { appKey: APP_KEY, begin: createTime, end: createTime });
});

test("getHistoryPvUvIplistByRange buckets the range into local days", async () => {
  const { service, mongoCalls } = buildService({ dayNum: null });
  const surveys: { begin: Date; end: Date; history?: boolean }[] = [];
  service.getPvUvIpSurvey = (async (_appKey: string, begin: Date, end: Date, history?: boolean) => {
    surveys.push({ begin, end, history });
    return { pv: 1 };
  }) as never;
  const days = await service.getHistoryPvUvIplistByRange(
    APP_KEY,
    new Date(2020, 0, 14, 13, 30),
    new Date(2020, 0, 15, 9, 0),
  );
  assert.equal(days.length, 2);
  assert.deepEqual(
    days.map((d) => d.time),
    ["2020/01/14", "2020/01/15"],
  );
  assert.deepEqual(mongoCalls[0].begin, new Date(2020, 0, 14, 0, 0, 0));
  assert.deepEqual(mongoCalls[0].end, new Date(2020, 0, 14, 23, 59, 59));
  assert.equal(surveys[0].history, true, "a per-day backfill must use the history survey shape");
  assert.equal(days[0].num, 0, "a missing day-report row defaults to 0");
  assert.equal(days[0].pv, 1, "the survey fields are spread into the day bucket");
});

test("getPvUvIpSurveyOne reads the today's count from Redis when the range covers now", async () => {
  const doc = { toObject: () => ({ appKey: APP_KEY, pv: 5 }) };
  const { service, redisCalls, mongoCalls } = buildService({ findOneRow: doc, todayNum: "42" });
  const begin = new Date(Date.now() - 3_600_000);
  const end = new Date(Date.now() + 3_600_000);
  const result = await service.getPvUvIpSurveyOne(APP_KEY, begin, end);
  assert.equal(result.num, "42");
  assert.equal(result.pv, 5);
  assert.equal(redisCalls[0].today, new Date(func.format(new Date(), "yyyy/MM/dd")).getTime());
  assert.equal(mongoCalls.length, 0, "the Mongo day report must not be consulted for a live range");
});

test("getPvUvIpSurveyOne reads the day report from Mongo for a past range", async () => {
  const doc = { toObject: () => ({ appKey: APP_KEY, pv: 5 }) };
  const { service, redisCalls, mongoCalls } = buildService({ findOneRow: doc, dayNum: { num: 7 } });
  const begin = new Date(2020, 0, 10, 0, 0, 0);
  const end = new Date(2020, 0, 10, 23, 59, 59);
  const result = await service.getPvUvIpSurveyOne(APP_KEY, begin, end);
  assert.equal(result.num, 7);
  assert.equal(redisCalls.length, 0);
  assert.deepEqual(mongoCalls[0], { appKey: APP_KEY, begin, end });
});

test("getPvUvIpSurveyOne defaults a missing day report to 0", async () => {
  const doc = { toObject: () => ({ appKey: APP_KEY }) };
  const { service } = buildService({ findOneRow: doc, dayNum: null });
  const result = await service.getPvUvIpSurveyOne(APP_KEY, new Date(2020, 0, 10), new Date(2020, 0, 10, 23, 59, 59));
  assert.equal(result.num, 0);
});

test("getPvUvIpSurveyOne computes and persists a daily row on a cache miss", async () => {
  const { service, pv } = buildService({ findOneRow: null });
  const begin = new Date(2020, 0, 10, 0, 0, 0);
  const end = new Date(2020, 0, 10, 23, 59, 59);
  const surveys: { history?: boolean }[] = [];
  service.getPvUvIpSurvey = (async (_a: string, _b: Date, _e: Date, history?: boolean) => {
    surveys.push({ history });
    return { pv: 9 };
  }) as never;
  const savedArgs: { endTime: Date; type: number; data: unknown }[] = [];
  const sentinel = { saved: true };
  service.savePvUvIpData = (async (_a: string, endTime: Date, type: number, data: unknown) => {
    savedArgs.push({ endTime, type, data });
    return sentinel;
  }) as never;
  const result = await service.getPvUvIpSurveyOne(APP_KEY, begin, end);
  assert.deepEqual(pv.findOneCalls[0].filter, { appKey: APP_KEY, type: 2, createTime: { $gte: begin, $lte: end } });
  assert.equal(surveys[0].history, true);
  assert.deepEqual(
    savedArgs,
    [{ endTime: begin, type: 2, data: { pv: 9 } }],
    "a daily row is stamped at the range start",
  );
  assert.equal(result, sentinel);
});

test("getPvUvIpSurvey without history returns the five realtime counters only", async () => {
  const { service } = buildService({ pvCount: 5 });
  const result = await service.getPvUvIpSurvey(APP_KEY, new Date(2020, 0, 1), new Date(2020, 0, 2));
  assert.deepEqual(result, { pv: 5, uv: 0, ip: 0, ajax: 0, flow: 0 });
  assert.ok(!("user" in result), "a realtime survey must not carry the history-only user counter");
  assert.ok(!("bounce" in result));
});

test("getPvUvIpSurvey with history adds the user and bounce counters", async () => {
  const { service } = buildService({ envAggRows: [] });
  const result = await service.getPvUvIpSurvey(APP_KEY, new Date(2020, 0, 1), new Date(2020, 0, 2), true);
  assert.deepEqual(result, { pv: 0, uv: 0, ip: 0, ajax: 0, user: 0, bounce: 0, flow: 0 });
});

test("pv passes the time match through to the per-appKey page collection", async () => {
  const { service, pageCounts } = buildService({ pvCount: 12 });
  const query = { createTime: { $gte: new Date(2020, 0, 1), $lte: new Date(2020, 0, 2) } };
  assert.equal(await service.pv(APP_KEY, query), 12);
  assert.deepEqual(pageCounts[0], { appKey: APP_KEY, query });
});

test("uv/ip/user aggregate distinct counters out of the environment collection", async () => {
  const { service, envAggs } = buildService({ envAggRows: [{ count: 3 }] });
  const query = { createTime: { $gte: new Date(2020, 0, 1) } };
  assert.equal((await service.uv(APP_KEY, query))[0].count, 3);
  assert.deepEqual(envAggs[0].pipeline, [
    { $match: query },
    { $group: { _id: { markUv: "$markUv", uid: "$uid", phone: "$phone" } } },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  await service.ip(APP_KEY, query);
  assert.deepEqual(envAggs[1].pipeline, [
    { $match: query },
    { $project: { ip: true } },
    { $group: { _id: "$ip" } },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  await service.user(APP_KEY, query);
  assert.deepEqual(envAggs[2].pipeline, [
    { $match: query },
    { $project: { markUser: true } },
    { $group: { _id: "$markUser" } },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
});

test("bounce counts single-page users and defaults to 0", async () => {
  const { service, envAggs } = buildService({ envAggRows: [{ bounce: 4 }] });
  const query = { createTime: { $gte: new Date(2020, 0, 1) } };
  assert.equal(await service.bounce(APP_KEY, query), 4);
  assert.deepEqual(envAggs[0].pipeline, [
    { $match: query },
    { $group: { _id: { markUser: "$markUser" }, urls: { $push: 1 }, count: { $sum: 1 } } },
    { $match: { count: 1 } },
    { $count: "bounce" },
  ]);
  const empty = buildService({ envAggRows: [] });
  assert.equal(await empty.service.bounce(APP_KEY, query), 0);
});

test("ajax and flow query ClickHouse with formatted local time bounds", async () => {
  const { service, chFinds } = buildService({ chRows: [{ count: 4 }] });
  const times = { beginTime: new Date(2020, 0, 15, 8, 30, 5), endTime: new Date(2020, 0, 15, 9, 30, 5) };
  assert.equal(await service.ajax(APP_KEY, times), 4);
  assert.equal(chFinds[0].appKey, APP_KEY);
  assert.equal(chFinds[0].query.select, "count() as count");
  assert.equal(
    chFinds[0].query.where,
    "createTime >= toDateTime({beginTime:String}) AND createTime <= toDateTime({endTime:String})",
  );
  assert.deepEqual(chFinds[0].query.queryParams, { beginTime: "2020/01/15 08:30:05", endTime: "2020/01/15 09:30:05" });

  const flow = buildService({ chRows: [{ sum: 123 }] });
  assert.equal(await flow.service.flow(APP_KEY, times), 123);
  assert.equal(flow.chFinds[0].query.select, "sum(bodySize) as sum");

  const empty = buildService({ chRows: [] });
  assert.equal(await empty.service.ajax(APP_KEY, times), 0, "an empty ClickHouse result defaults to 0");
  assert.equal(await empty.service.flow(APP_KEY, times), 0);
});

test("savePvUvIpData coerces numerics, derives bounce rate and depth, and stamps the row", async () => {
  const { service, pv } = buildService();
  const endTime = new Date("2026-01-01T00:00:00.000Z");
  await service.savePvUvIpData(APP_KEY, endTime, 2, {
    pv: "10",
    uv: "4",
    ip: 2,
    ajax: 1,
    flow: 100,
    bounce: 1,
    user: 3,
  });
  assert.deepEqual(pv.saved[0], {
    appKey: APP_KEY,
    pv: 10,
    uv: 4,
    ip: 2,
    ajax: 1,
    flow: 100,
    bounce: "10.00%",
    depth: 3,
    createTime: endTime,
    type: 2,
  });
});

test("savePvUvIpData defaults missing numerics, a zero bounce, and a zero depth", async () => {
  const { service, pv } = buildService();
  await service.savePvUvIpData(APP_KEY, new Date(), 1, { pv: 0, user: 5, bounce: 0 });
  const row = pv.saved[0];
  assert.equal(row.pv, 0);
  assert.equal(row.uv, 0);
  assert.equal(row.bounce, "0");
  assert.equal(row.depth, 0, "depth must be 0 when pv is 0 instead of dividing by zero");
});

test("getMatch maps beginTime and endTime onto createTime bounds", async () => {
  const { service } = buildService();
  assert.deepEqual(service.getMatch(), {});
  assert.deepEqual(service.getMatch(new Date("2026-01-01T00:00:00.000Z")), {
    createTime: { $gte: new Date("2026-01-01T00:00:00.000Z") },
  });
  assert.deepEqual(service.getMatch(new Date("2026-01-01T00:00:00.000Z"), "2026-01-02T00:00:00.000Z"), {
    createTime: { $gte: new Date("2026-01-01T00:00:00.000Z"), $lte: new Date("2026-01-02T00:00:00.000Z") },
  });
});
