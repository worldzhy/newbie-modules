import assert from "node:assert/strict";
import test from "node:test";
import { AjaxService } from "./ajax.service";

type FindArgs = Record<string, unknown> | Record<string, unknown>[];

function newService(opts: { countRows?: unknown[]; listRows?: Record<string, unknown>[] } = {}) {
  const appKeys: string[] = [];
  const finds: { args: FindArgs }[] = [];
  const ch = {
    WebAjax: (appKey: string) => {
      appKeys.push(appKey);
      return {
        find: (args: FindArgs) => {
          finds.push({ args });
          return Promise.resolve(Array.isArray(args) ? (opts.countRows ?? [{ total: 0 }]) : (opts.listRows ?? []));
        },
      };
    },
  };
  return { service: new AjaxService(ch as never), appKeys, finds };
}

function listQuery(finds: { args: FindArgs }[]) {
  const call = finds.find((f) => !Array.isArray(f.args));
  assert.ok(call, "expected a single-object find call for the list query");
  return call.args as Record<string, unknown>;
}

function countStages(finds: { args: FindArgs }[]) {
  const call = finds.find((f) => Array.isArray(f.args));
  assert.ok(call, "expected a pipelined find call for the count query");
  return call.args as Record<string, unknown>[];
}

test("getAverageAjaxList scopes the query to the given appKey", async () => {
  const { service, appKeys } = newService();
  await service.getAverageAjaxList({ appKey: "abc123" });
  assert.deepEqual(appKeys, ["abc123"]);
});

test("getAverageAjaxList binds the url search as a parameterized ilike, never interpolated", async () => {
  const { service, finds } = newService();
  await service.getAverageAjaxList({ appKey: "k", url: "/api/(users).*" });
  const list = listQuery(finds);
  assert.match(String(list.where), /ilike\(url, \{url:String\}\)/);
  assert.equal((list.queryParams as Record<string, unknown>).url, "%/api/(users).*%");
  assert.ok(!String(list.where).includes("/api/(users).*"), "raw search text must never reach the where string");
});

test("getAverageAjaxList adds the slow-request clause only for type 2", async () => {
  const slow = newService();
  await slow.service.getAverageAjaxList({ appKey: "k", type: 2 });
  assert.match(String(listQuery(slow.finds).where), /duration > 2000/);

  const fast = newService();
  await fast.service.getAverageAjaxList({ appKey: "k", type: 1 });
  assert.equal(listQuery(fast.finds).where, undefined, "type 1 must not restrict duration");
});

test("getAverageAjaxList maps beginTime/endTime onto a createTime range", async () => {
  const { service, finds } = newService();
  await service.getAverageAjaxList({ appKey: "k", beginTime: "2026-11-01 00:00:00", endTime: "2026-11-02 00:00:00" });
  const list = listQuery(finds);
  assert.match(String(list.where), /createTime >= toDateTime\(\{beginTime:String\}\)/);
  assert.match(String(list.where), /createTime <= toDateTime\(\{endTime:String\}\)/);
  assert.deepEqual(list.queryParams, { beginTime: "2026-11-01 00:00:00", endTime: "2026-11-02 00:00:00" });
});

test("getAverageAjaxList paginates with skip/limit math and sorts by average duration", async () => {
  const { service, finds } = newService();
  await service.getAverageAjaxList({ appKey: "k", pageNo: 3, pageSize: 10 });
  const list = listQuery(finds);
  assert.equal(list.limit, 10);
  assert.equal(list.skip, 20);
  assert.equal(list.orderBy, "durationAvg DESC");
});

test("getAverageAjaxList defaults to the configured page size and the first page", async () => {
  const { service, finds } = newService();
  const result = await service.getAverageAjaxList({ appKey: "k" });
  const list = listQuery(finds);
  assert.equal(list.limit, 15);
  assert.equal(list.skip, 0);
  assert.equal(result.pageNo, 1);
});

test("getAverageAjaxList reshapes rows and falls back to a zero total", async () => {
  const { service } = newService({ countRows: [], listRows: [{ url: "/a", method: "GET", durationAvg: 12 }] });
  const result = await service.getAverageAjaxList({ appKey: "k" });
  assert.equal(result.totalNum, 0);
  const row = result.dataList[0] as Record<string, unknown>;
  assert.deepEqual(row._id, { method: "GET", url: "/a" });
  assert.equal(row.duration, 12);
});

test("getAverageAjaxList counts grouped url/method pairs", async () => {
  const { service, finds } = newService({ countRows: [{ total: 7 }] });
  const result = await service.getAverageAjaxList({ appKey: "k" });
  assert.equal(countStages(finds)[0].groupBy, "url,method");
  assert.equal(result.totalNum, 7);
});

test("getPageAjaxsAvg matches callUrl exactly and returns the full list as page 1", async () => {
  const { service, finds } = newService({ listRows: [] });
  const result = await service.getPageAjaxsAvg("k", "/api/exact", "2026-11-01 00:00:00");
  const list = listQuery(finds);
  assert.match(String(list.where), /callUrl = \{url:String\}/);
  assert.equal((list.queryParams as Record<string, unknown>).url, "/api/exact", "an exact match must not be %-wrapped");
  assert.equal(list.limit, undefined);
  assert.equal(list.skip, undefined);
  assert.equal(result.pageNo, 1);
});

test("getOneAjaxList sorts by recency and counts raw rows", async () => {
  const { service, finds } = newService({ countRows: [{ total: 3 }] });
  const result = await service.getOneAjaxList("k", undefined, 2, 10);
  const list = listQuery(finds);
  assert.equal(list.select, "*");
  assert.equal(list.orderBy, "createTime DESC");
  assert.equal(list.skip, 10);
  assert.equal(list.limit, 10);
  assert.equal(countStages(finds)[0].groupBy, undefined, "raw rows are counted without grouping");
  assert.equal(result.totalNum, 3);
  assert.equal(result.pageNo, 2);
});

test("getMarkUserAjaxList filters by markUser with an exclusive end bound, ascending", async () => {
  const { service, finds, appKeys } = newService();
  await service.getMarkUserAjaxList("k", {
    markUser: "u1",
    beginTime: "2026-11-01 00:00:00",
    endTime: "2026-11-02 00:00:00",
  });
  const list = listQuery(finds);
  assert.match(String(list.where), /markUser = \{markUser:String\}/);
  assert.match(String(list.where), /createTime >= toDateTime\(\{beginTime:String\}\)/);
  assert.match(String(list.where), /createTime < toDateTime\(\{endTime:String\}\)/);
  assert.equal(list.orderBy, "createTime ASC");
  assert.deepEqual(appKeys, ["k"]);
});
