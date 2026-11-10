import assert from "node:assert/strict";
import { test } from "node:test";

import { FrontendMonitorAnalysisService } from "./analysis.service";

/**
 * Read-side contracts for FrontendMonitorAnalysisService: every query is routed
 * through the per-appKey model factories, time bounds land on createTime as
 * Date objects, and the top-N pipelines are capped by the code-owned
 * top_alalysis_size.web limit (10). getAnalysisOneList is a pure pass-through
 * (find by markUser, no branching) and is intentionally not covered.
 */

type Pipeline = Record<string, unknown>[];

interface AggCall {
  pipeline: Pipeline;
  readMode?: string;
}

function aggregateStub(result: unknown[]) {
  const calls: AggCall[] = [];
  const aggregate = (pipeline: Pipeline) => {
    const call: AggCall = { pipeline };
    calls.push(call);
    return {
      read(mode: string) {
        call.readMode = mode;
        return { exec: async () => result };
      },
    };
  };
  return { aggregate, calls };
}

function buildService(opts: { aggregateResult?: unknown[] } = {}) {
  const env = aggregateStub(opts.aggregateResult ?? []);
  const page = aggregateStub(opts.aggregateResult ?? []);
  const appKeys: { env: string[]; page: string[] } = { env: [], page: [] };
  const models = {
    WebEnvironment: (appKey: string) => {
      appKeys.env.push(appKey);
      return { aggregate: env.aggregate };
    },
    WebPage: (appKey: string) => {
      appKeys.page.push(appKey);
      return { aggregate: page.aggregate };
    },
  };
  const service = new FrontendMonitorAnalysisService(models as never);
  return { service, env, page, appKeys };
}

test("getAnalysislist without filters matches everything and groups by markUser", async () => {
  const { service, env, appKeys } = buildService({ aggregateResult: [{ _id: { markUser: "u1" } }] });
  const result = await service.getAnalysislist("app1");
  assert.deepEqual(result, { list: [{ _id: { markUser: "u1" } }] });
  const pipeline = env.calls[0].pipeline;
  assert.deepEqual(pipeline[0], { $match: {} });
  assert.deepEqual(pipeline[1], { $group: { _id: { markUser: "$markUser" }, visitTime: { $first: "$createTime" } } });
  assert.deepEqual(pipeline[2], { $sort: { visitTime: 1 } });
  assert.equal(env.calls[0].readMode, "secondaryPreferred");
  assert.deepEqual(appKeys.env, ["app1"], "the query must be scoped to the per-appKey collection");
});

test("getAnalysislist maps filter and time range onto the $match stage", async () => {
  const { service, env } = buildService();
  await service.getAnalysislist("app1", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", {
    phone: "138",
    uid: "u-1",
  });
  const match = env.calls[0].pipeline[0].$match as Record<string, unknown>;
  assert.equal(match.phone, "138");
  assert.equal(match.uid, "u-1");
  assert.deepEqual(match.createTime, {
    $gte: new Date("2026-01-01T00:00:00.000Z"),
    $lte: new Date("2026-01-02T00:00:00.000Z"),
  });
});

test("getAnalysislist applies single-sided time bounds", async () => {
  const { service, env } = buildService();
  await service.getAnalysislist("app1", "2026-01-01T00:00:00.000Z");
  const match = env.calls[0].pipeline[0].$match as Record<string, unknown>;
  const createTime = match.createTime as Record<string, unknown>;
  assert.deepEqual(createTime.$gte, new Date("2026-01-01T00:00:00.000Z"));
  assert.ok(!("$lte" in createTime), "a missing endTime must not produce a $lte bound");
});

test("getTopDatas returns all four sections and routes models by appKey", async () => {
  const { service, appKeys } = buildService({ aggregateResult: [] });
  const result = await service.getTopDatas("app1");
  assert.deepEqual(Object.keys(result), ["top_pages", "top_jump_out", "top_browser", "provinces"]);
  assert.deepEqual(appKeys.page, ["app1"], "top pages must come from the per-appKey page collection");
  assert.deepEqual(appKeys.env, ["app1", "app1", "app1"], "the other three sections read the environment collection");
});

test("every top pipeline sorts by count descending and caps at the configured limit", async () => {
  const { service, env, page } = buildService();
  await service.getTopDatas("app1", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  for (const call of [...page.calls, ...env.calls]) {
    assert.deepEqual(call.pipeline[call.pipeline.length - 2], { $sort: { count: -1 } });
    assert.deepEqual(call.pipeline[call.pipeline.length - 1], { $limit: 10 });
    const match = call.pipeline[0].$match as Record<string, unknown>;
    assert.deepEqual(match.createTime, {
      $gte: new Date("2026-01-01T00:00:00.000Z"),
      $lte: new Date("2026-01-02T00:00:00.000Z"),
    });
  }
});

test("the top-pages pipeline groups by url", async () => {
  const { service, page } = buildService();
  await service.getTopDatas("app1");
  assert.deepEqual(page.calls[0].pipeline[1], { $group: { _id: { url: "$url" }, count: { $sum: 1 } } });
});

test("the jump-out pipeline keeps only single-visit users before grouping by url", async () => {
  const { service, env } = buildService();
  await service.getTopDatas("app1");
  const jumpOut = env.calls[0].pipeline;
  assert.deepEqual(jumpOut[2], { $match: { count: 1 } }, "a jump-out visit is a user with exactly one page");
  assert.deepEqual(jumpOut[3], {
    $group: { _id: { value: { $arrayElemAt: ["$urls", 0] } }, count: { $sum: 1 } },
  });
});

test("getProvinceCount groups by province and wraps the rows", async () => {
  const { service, env } = buildService({ aggregateResult: [{ _id: { province: "P" }, count: 2 }] });
  const result = await service.getProvinceCount("app1");
  assert.deepEqual(result, { provinces: [{ _id: { province: "P" }, count: 2 }] });
  assert.deepEqual(env.calls[0].pipeline[1], { $group: { _id: { province: "$province" }, count: { $sum: 1 } } });
});
