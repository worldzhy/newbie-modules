import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { RemoveService } from "./remove.service";

/**
 * Cascade-remove contract of RemoveService.customDelete: a mandatory day
 * range, a web-only gate, Mongo collections deleted by a createTime range
 * filter, ClickHouse tables deleted by a parameterized datetime predicate.
 * The service touches no cache — site-cache eviction is not its concern.
 */

type Row = Record<string, unknown>;

function harness() {
  const mongoCalls: Array<{ collection: string; appKey: string; filter: Row }> = [];
  const mongoModel = (collection: string, appKey: string) => ({
    deleteMany: (filter: Row) => ({
      exec: async () => {
        mongoCalls.push({ collection, appKey, filter });
        return { deletedCount: 1 };
      },
    }),
  });
  const models = {
    WebPage: (appKey: string) => mongoModel("WebPage", appKey),
    WebEnvironment: (appKey: string) => mongoModel("WebEnvironment", appKey),
    WebResource: (appKey: string) => mongoModel("WebResource", appKey),
  };

  const chCalls: Array<{ table: string; appKey: string; where: string; queryParams: Row }> = [];
  const chModel = (table: string, appKey: string) => ({
    delete: async (args: { where: string; queryParams: Row }) => {
      chCalls.push({ table, appKey, where: args.where, queryParams: args.queryParams });
      return { executed: true };
    },
  });
  const clickhouse = {
    WebAjax: async (appKey: string) => chModel("WebAjax", appKey),
    WebError: async (appKey: string) => chModel("WebError", appKey),
  };

  const service = new RemoveService(models as never, clickhouse as never);
  return { service, mongoCalls, chCalls };
}

const TIME = ["2026-11-01", "2026-11-05"];

test("a delete without a time range is rejected before any store is touched", async () => {
  const h = harness();
  await assert.rejects(
    () => h.service.customDelete("APP1", { type: "web", resource: ["page"] }),
    (error) => error instanceof BadRequestException && error.message === "A time must be selected",
  );
  await assert.rejects(
    () => h.service.customDelete("APP1", { type: "web", resource: ["page"], time: [] }),
    (error) => error instanceof BadRequestException,
  );
  assert.equal(h.mongoCalls.length + h.chCalls.length, 0);
});

test("a non-web type or an empty resource list deletes nothing and returns null", async () => {
  const h = harness();
  assert.equal(await h.service.customDelete("APP1", { type: "app", resource: ["page"], time: TIME }), null);
  assert.equal(await h.service.customDelete("APP1", { type: "web", resource: [], time: TIME }), null);
  assert.equal(h.mongoCalls.length + h.chCalls.length, 0);
});

test("Mongo stores are deleted with a createTime day-range filter under the appKey partition", async () => {
  const h = harness();
  await h.service.customDelete("APP1", { type: "web", resource: ["page", "env", "resource"], time: TIME });
  assert.deepEqual(
    h.mongoCalls.map((call) => call.collection),
    ["WebPage", "WebEnvironment", "WebResource"],
  );
  for (const call of h.mongoCalls) {
    assert.equal(call.appKey, "APP1");
    const range = call.filter.createTime as { $gte: Date; $lte: Date };
    assert.equal(range.$gte.getTime(), new Date("2026-11-01 00:00:00").getTime(), "the first day starts at 00:00:00");
    assert.equal(range.$lte.getTime(), new Date("2026-11-05 23:59:59").getTime(), "the last day ends at 23:59:59");
  }
});

test("ClickHouse stores are deleted with a parameterized datetime predicate", async () => {
  const h = harness();
  await h.service.customDelete("APP1", { type: "web", resource: ["ajax", "err"], time: TIME });
  assert.deepEqual(
    h.chCalls.map((call) => call.table),
    ["WebAjax", "WebError"],
  );
  for (const call of h.chCalls) {
    assert.equal(call.appKey, "APP1");
    assert.equal(
      call.where,
      "createTime <= toDateTime({endTime:String}) AND createTime >= toDateTime({startTime:String})",
    );
    assert.deepEqual(call.queryParams, { startTime: "2026-11-01 00:00:00", endTime: "2026-11-05 23:59:59" });
  }
});

test("a full removal deletes every known store in one call", async () => {
  const h = harness();
  const result = (await h.service.customDelete("APP1", {
    type: "web",
    resource: ["ajax", "page", "env", "err", "resource"],
    time: TIME,
  })) as unknown[];
  assert.equal(result.length, 5);
  assert.equal(h.mongoCalls.length, 3);
  assert.equal(h.chCalls.length, 2);
});

test("unknown resource names are ignored", async () => {
  const h = harness();
  const result = (await h.service.customDelete("APP1", {
    type: "web",
    resource: ["page", "bogus" as never],
    time: TIME,
  })) as unknown[];
  assert.equal(result.length, 1);
  assert.deepEqual(
    h.mongoCalls.map((call) => call.collection),
    ["WebPage"],
  );
});
