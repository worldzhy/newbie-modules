import assert from "node:assert/strict";
import test from "node:test";
import { ErrorService } from "./error.service";

type FindArgs = Record<string, unknown> | Record<string, unknown>[];

function newService(
  opts: {
    countRows?: unknown[];
    listRows?: Record<string, unknown>[];
    otherRows?: Record<string, unknown>[];
  } = {},
) {
  const appKeys: string[] = [];
  const finds: { args: FindArgs }[] = [];
  const ch = {
    WebError: (appKey: string) => {
      appKeys.push(appKey);
      return {
        find: (args: FindArgs) => {
          finds.push({ args });
          if (Array.isArray(args)) return Promise.resolve(opts.countRows ?? [{ total: 0 }]);
          const select = String((args as Record<string, unknown>).select ?? "");
          if (select === "count() as total") return Promise.resolve(opts.countRows ?? [{ total: 0 }]);
          if (select.includes("MIN(createTime)")) return Promise.resolve(opts.otherRows ?? []);
          return Promise.resolve(opts.listRows ?? []);
        },
      };
    },
  };
  const config = { get: () => ({}) };
  return { service: new ErrorService(ch as never, config as never), appKeys, finds };
}

function listQuery(finds: { args: FindArgs }[]) {
  const call = finds.find((f) => {
    if (Array.isArray(f.args)) return false;
    const select = String((f.args as Record<string, unknown>).select ?? "");
    return select !== "count() as total" && !select.includes("MIN(createTime)");
  });
  assert.ok(call, "expected a find call for the list query");
  return call.args as Record<string, unknown>;
}

function countStages(finds: { args: FindArgs }[]) {
  const call = finds.find((f) => Array.isArray(f.args));
  assert.ok(call, "expected a pipelined find call for the count query");
  return call.args as Record<string, unknown>[];
}

function statsQuery(finds: { args: FindArgs }[]) {
  const call = finds.find(
    (f) =>
      !Array.isArray(f.args) && String((f.args as Record<string, unknown>).select ?? "").includes("MIN(createTime)"),
  );
  assert.ok(call, "expected a find call for the side-stats query");
  return call.args as Record<string, unknown>;
}

test("getAverageErrorList scopes the query to the given appKey", async () => {
  const { service, appKeys } = newService();
  await service.getAverageErrorList({ appKey: "abc123", type: "log" });
  assert.deepEqual(appKeys, ["abc123"]);
});

test("getAverageErrorList splits a piped type filter into an IN list", async () => {
  const { service, finds } = newService();
  await service.getAverageErrorList({ appKey: "k", type: "ajax|fetch" });
  const list = listQuery(finds);
  assert.match(String(list.where), /type IN \(\{typeArr:Array\(String\)\}\)/);
  assert.deepEqual((list.queryParams as Record<string, unknown>).typeArr, ["ajax", "fetch"]);
});

test("getAverageErrorList picks the grouping key from the error type", async () => {
  const expected: Record<string, string> = {
    script: "resourceUrl,name,type",
    resource: "resourceUrl,type",
    "ajax|fetch": "resourceUrl,status,type",
    "bussiness-ajax|bussiness-fetch": "resourceUrl,status,type",
    log: "resourceUrl,type",
  };
  for (const [type, groupBy] of Object.entries(expected)) {
    const { service, finds } = newService();
    await service.getAverageErrorList({ appKey: "k", type });
    assert.equal(listQuery(finds).groupBy, groupBy, `type "${type}" must group by "${groupBy}"`);
    assert.equal(countStages(finds)[0].groupBy, groupBy, `the count query must mirror the grouping for "${type}"`);
  }
});

test("getAverageErrorList binds text filters as parameterized ilikes, never interpolated", async () => {
  const { service, finds } = newService();
  await service.getAverageErrorList({ appKey: "k", type: "log", resourceUrl: "/x.*", phone: "138", uid: "u-1" });
  const list = listQuery(finds);
  const params = list.queryParams as Record<string, unknown>;
  assert.match(String(list.where), /ilike\(resourceUrl, \{resourceUrl:String\}\)/);
  assert.match(String(list.where), /ilike\(phone, \{phone:String\}\)/);
  assert.match(String(list.where), /ilike\(uid, \{uid:String\}\)/);
  assert.equal(params.resourceUrl, "%/x.*%");
  assert.equal(params.phone, "%138%");
  assert.equal(params.uid, "%u-1%");
  assert.ok(!String(list.where).includes("/x.*"), "raw search text must never reach the where string");
});

test("getAverageErrorList maps the time range and paginates with a count sort", async () => {
  const { service, finds } = newService();
  await service.getAverageErrorList({
    appKey: "k",
    type: "log",
    beginTime: "2026-11-01 00:00:00",
    endTime: "2026-11-02 00:00:00",
    pageNo: 4,
    pageSize: 5,
  });
  const list = listQuery(finds);
  assert.match(String(list.where), /createTime >= toDateTime\(\{beginTime:String\}\)/);
  assert.match(String(list.where), /createTime <= toDateTime\(\{endTime:String\}\)/);
  assert.equal(list.limit, 5);
  assert.equal(list.skip, 15);
  assert.equal(list.orderBy, "count DESC");
});

test("getAverageErrorList with realTime=1 returns raw rows in recency order without grouping", async () => {
  const { service, finds } = newService({ countRows: [{ total: 9 }], listRows: [{ msg: "boom" }] });
  const result = await service.getAverageErrorList({ appKey: "k", realTime: 1, pageSize: 5 });
  const list = listQuery(finds);
  assert.equal(list.select, "*");
  assert.equal(list.orderBy, "createTime DESC");
  assert.equal(list.groupBy, undefined);
  assert.equal(result.totalNum, 9);
});

test("getAverageErrorList spreads each aggregated row into its own _id", async () => {
  const { service } = newService({ listRows: [{ resourceUrl: "/a", count: 2 }] });
  const result = await service.getAverageErrorList({ appKey: "k", type: "log" });
  const row = result.dataList[0] as Record<string, unknown>;
  assert.deepEqual(row._id, { resourceUrl: "/a", count: 2 });
});

test("getAverageErrorList pins current behavior around absent filters", async () => {
  // Documents current behavior, quirks included: a lone type filter still
  // emits the IN clause; omitting type leaves where undefined but keeps the
  // empty groupBy and the leading-comma select (suspected source bug, pinned
  // as-is).
  const withType = newService();
  await withType.service.getAverageErrorList({ appKey: "k", type: "log" });
  const typedList = listQuery(withType.finds);
  assert.equal(typedList.where, "type IN ({typeArr:Array(String)})");
  assert.deepEqual((typedList.queryParams as Record<string, unknown>).typeArr, ["log"]);

  const bare = newService();
  await bare.service.getAverageErrorList({ appKey: "k" });
  const bareList = listQuery(bare.finds);
  assert.equal(bareList.where, undefined);
  assert.equal(bareList.groupBy, "");
  assert.match(String(bareList.select), /^, MAX\(createTime\)/);
});

test("getOneErrorList matches url, name, status and type exactly", async () => {
  const { service, finds } = newService();
  await service.getOneErrorList({ appKey: "k", url: "/a", name: "TypeError", status: "500", type: "ajax" });
  const list = listQuery(finds);
  const params = list.queryParams as Record<string, unknown>;
  assert.match(String(list.where), /resourceUrl = \{url:String\}/);
  assert.match(String(list.where), /name = \{name:String\}/);
  assert.match(String(list.where), /status = \{status:String\}/);
  assert.match(String(list.where), /type = \{type:String\}/);
  assert.equal(params.url, "/a");
  assert.equal(params.name, "TypeError");
  assert.equal(params.status, "500");
  assert.equal(params.type, "ajax");
});

test("getOneErrorList binds phone and uid as parameterized ilikes", async () => {
  const { service, finds } = newService();
  await service.getOneErrorList({ appKey: "k", phone: "138", uid: "u-1" });
  const params = listQuery(finds).queryParams as Record<string, unknown>;
  assert.equal(params.phone, "%138%");
  assert.equal(params.uid, "%u-1%");
});

test("getOneErrorList returns first/last/userNum side stats grouped by resourceUrl", async () => {
  const { service, finds } = newService({ otherRows: [{ userNum: "3", first: "f", last: "l" }] });
  const result = await service.getOneErrorList({ appKey: "k" });
  assert.equal(statsQuery(finds).groupBy, "resourceUrl");
  assert.equal(result.userNum, 3);
  assert.equal(result.first, "f");
  assert.equal(result.last, "l");
});

test("getOneErrorList defaults the side stats when nothing matches", async () => {
  const { service } = newService({ otherRows: [] });
  const result = await service.getOneErrorList({ appKey: "k" });
  assert.equal(result.userNum, 0);
  assert.equal(result.first, "");
  assert.equal(result.last, "");
});

test("getOneErrorList paginates raw rows by recency", async () => {
  const { service, finds } = newService({ countRows: [{ total: 30 }] });
  const result = await service.getOneErrorList({ appKey: "k", pageNo: 3, pageSize: 20 });
  const list = listQuery(finds);
  assert.equal(list.select, "*");
  assert.equal(list.orderBy, "createTime DESC");
  assert.equal(list.skip, 40);
  assert.equal(list.limit, 20);
  assert.equal(result.totalNum, 30);
  assert.equal(result.pageNo, 3);
});

test("getMarkUserErrorListCH filters by markUser with an exclusive end bound, ascending", async () => {
  const { service, finds, appKeys } = newService();
  await service.getMarkUserErrorListCH("k", {
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
