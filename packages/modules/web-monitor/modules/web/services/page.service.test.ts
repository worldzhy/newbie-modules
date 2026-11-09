import assert from "node:assert/strict";
import test from "node:test";
import { PageService } from "./page.service";

type Filter = Record<string, unknown>;
type Pipeline = Record<string, unknown>[];

function newService(
  opts: {
    count?: number;
    aggRows?: Record<string, unknown>[];
    distinctValues?: string[];
    doc?: unknown;
  } = {},
) {
  const appKeys: string[] = [];
  const counts: Filter[] = [];
  const pipelines: Pipeline[] = [];
  const distincts: { field: string; match: Filter }[] = [];
  const findOnes: Filter[] = [];
  const reads: string[] = [];
  const chain = (exec: () => Promise<unknown>) => ({
    read: (mode: string) => {
      reads.push(mode);
      return { exec };
    },
  });
  const models = {
    WebPage: (appKey: string) => {
      appKeys.push(appKey);
      return {
        count: (match: Filter) => {
          counts.push(match);
          return chain(async () => opts.count ?? 0);
        },
        aggregate: (pipeline: Pipeline) => {
          pipelines.push(pipeline);
          return chain(async () => opts.aggRows ?? []);
        },
        distinct: (field: string, match: Filter) => {
          distincts.push({ field, match });
          return chain(async () => opts.distinctValues ?? []);
        },
        findOne: (filter: Filter) => {
          findOnes.push(filter);
          return chain(async () => opts.doc ?? null);
        },
      };
    },
  };
  return {
    service: new PageService(models as never),
    appKeys,
    counts,
    pipelines,
    distincts,
    findOnes,
    reads,
  };
}

function stageNames(pipeline: Pipeline) {
  return pipeline.map((stage) => Object.keys(stage)[0]);
}

test("getAveragePageList without a url aggregates each distinct url of the current page only", async () => {
  const { service, distincts, pipelines } = newService({ distinctValues: ["u1", "u2", "u3"], aggRows: [{ count: 1 }] });
  const result = await service.getAveragePageList({ appKey: "k", pageNo: 2, pageSize: 2 });
  assert.equal(distincts[0].field, "url");
  assert.equal(pipelines.length, 1, "only the sliced urls of page 2 are aggregated");
  assert.equal((pipelines[0][0].$match as Filter).url, "u3");
  assert.equal(result.totalNum, 3, "totalNum counts all distinct urls, not just the current page");
  assert.equal(result.dataList.length, 1);
  assert.equal(result.pageNo, 2);
});

test("getAveragePageList drops urls whose group comes back empty", async () => {
  const { service } = newService({ distinctValues: ["u1", "u2"], aggRows: [] });
  const result = await service.getAveragePageList({ appKey: "k" });
  assert.equal(result.dataList.length, 0);
  assert.equal(result.totalNum, 2, "an empty group must not shrink the distinct total");
});

test("getAveragePageList enriches the per-url group with timing averages only in first-in mode", async () => {
  const firstIn = newService({ distinctValues: ["u1"], aggRows: [{}] });
  await firstIn.service.getAveragePageList({ appKey: "k", isFirstIn: "true" });
  const group = firstIn.pipelines[0][1].$group as Filter;
  assert.ok("loadTime" in group && "dnsTime" in group, "first-in mode must average the timing fields");

  const visit = newService({ distinctValues: ["u1"], aggRows: [{}] });
  await visit.service.getAveragePageList({ appKey: "k" });
  const plainGroup = visit.pipelines[0][1].$group as Filter;
  assert.deepEqual(Object.keys(plainGroup).sort(), ["_id", "count"], "visit mode only counts loads");
});

test("getAveragePageList with a url runs a single grouped aggregation", async () => {
  const { service, pipelines } = newService({ distinctValues: ["/a"], aggRows: [{ count: 5 }] });
  const result = await service.getAveragePageList({ appKey: "k", url: "/a", pageNo: 2, pageSize: 10 });
  assert.equal(pipelines.length, 1);
  assert.deepEqual(stageNames(pipelines[0]), ["$match", "$group", "$skip", "$sort", "$limit"]);
  assert.deepEqual((pipelines[0][1].$group as Filter)._id, { url: "$url" });
  assert.deepEqual(pipelines[0][3].$sort, { count: -1 });
  assert.equal(pipelines[0][2].$skip, 10);
  assert.equal(pipelines[0][4].$limit, 10);
  assert.equal(result.totalNum, 1);
});

test("getAveragePageList escapes user search text before compiling the regex", async () => {
  const { service, pipelines } = newService({ distinctValues: [] });
  await service.getAveragePageList({ appKey: "k", url: "a.*(b)" });
  const match = pipelines[0][0].$match as Filter;
  const regex = (match.url as { $regex: RegExp }).$regex;
  assert.ok(regex instanceof RegExp);
  assert.equal(regex.source, "a\\.\\*\\(b\\)", "metacharacters must be escaped, never compiled raw");
  assert.ok(regex.flags.includes("i"));
  assert.ok(regex.test("a.*(b)"), "the escaped regex still matches the literal text");
  assert.ok(!regex.test("aXXb"), "metacharacters must not act as a pattern");
});

test("getAveragePageList maps isFirstIn only when a non-empty value is given", async () => {
  const first = newService({ distinctValues: [] });
  await first.service.getAveragePageList({ appKey: "k", isFirstIn: "true" });
  assert.equal(first.distincts[0].match.isFirstIn, true);

  const notFirst = newService({ distinctValues: [] });
  await notFirst.service.getAveragePageList({ appKey: "k", isFirstIn: "false" });
  assert.equal(notFirst.distincts[0].match.isFirstIn, false);

  const empty = newService({ distinctValues: [] });
  await empty.service.getAveragePageList({ appKey: "k", isFirstIn: "" });
  assert.ok(!("isFirstIn" in empty.distincts[0].match), "an empty isFirstIn must not reach the match");
});

test("getAveragePageList maps beginTime/endTime onto createTime and coerces the type", async () => {
  const { service, distincts } = newService({ distinctValues: [] });
  await service.getAveragePageList({
    appKey: "k",
    type: "4",
    beginTime: "2026-11-01T00:00:00.000Z",
    endTime: "2026-11-02T00:00:00.000Z",
  });
  const match = distincts[0].match;
  assert.equal(match.speedType, 4);
  const createTime = match.createTime as { $gte: Date; $lte: Date };
  assert.equal(createTime.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(createTime.$lte.toISOString(), "2026-11-02T00:00:00.000Z");
});

test("getRealTimeAveragePageList matches first-in page loads inside the time window", async () => {
  const { service, pipelines } = newService();
  await service.getRealTimeAveragePageList({
    appKey: "k",
    type: "4",
    beginTime: "2026-11-05T00:00:00.000Z",
    endTime: "2026-11-05T00:01:00.000Z",
  });
  const match = pipelines[0][0].$match as Record<string, unknown>;
  assert.equal(match.isFirstIn, true);
  assert.equal(match.speedType, 4);
  const createTime = match.createTime as { $gte: Date; $lte: Date };
  assert.equal(createTime.$gte.toISOString(), "2026-11-05T00:00:00.000Z");
  assert.equal(createTime.$lte.toISOString(), "2026-11-05T00:01:00.000Z");
});

test("getRealTimeAveragePageList returns one zero-filled bucket per minute", async () => {
  const { service } = newService({ aggRows: [] });
  const result = await service.getRealTimeAveragePageList({
    appKey: "k",
    beginTime: "2026-11-05T00:00:00.000Z",
    endTime: "2026-11-05T00:02:00.000Z",
  });
  assert.equal(result.length, 3, "a two-minute span yields three minute buckets");
  for (const bucket of result) {
    assert.match(bucket.beginTime, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    assert.match(bucket.endTime, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    assert.equal(bucket.count, 0);
    assert.equal(bucket.loadTime, 0);
    assert.equal(bucket.dnsTime, 0);
  }
});

test("getRealTimeAveragePageList places a result into the minute bucket that contains it", async () => {
  const begin = new Date("2026-11-05T00:00:00.000Z").getTime();
  const row = {
    createTime: [new Date(begin + 90_000)],
    count: 5,
    loadTime: 2,
    dnsTime: 1,
    tcpTime: 1,
    whiteTime: 1,
    requestTime: 1,
    analysisDomTime: 1,
  };
  const { service } = newService({ aggRows: [row] });
  const result = await service.getRealTimeAveragePageList({
    appKey: "k",
    beginTime: "2026-11-05T00:00:00.000Z",
    endTime: "2026-11-05T00:02:00.000Z",
  });
  assert.equal(result[0].count, 0);
  assert.equal(result[1].count, 5);
  assert.equal(result[1].loadTime, 2);
  assert.equal(result[2].count, 0);
});

test("getOnePageList matches the exact url and coerces the appKey to a string", async () => {
  const { service, counts, appKeys } = newService();
  await service.getOnePageList({ appKey: 123, url: "/a" });
  assert.equal(appKeys[0], "123");
  assert.deepEqual(counts[0], { url: "/a" });
});

test("getOnePageList maps the isFirstIn representations", async () => {
  const second = newService();
  await second.service.getOnePageList({ appKey: "k", url: "/a", isFirstIn: "2" });
  assert.equal(second.counts[0].isFirstIn, true, "numeric 2 means a repeat visit");

  const first = newService();
  await first.service.getOnePageList({ appKey: "k", url: "/a", isFirstIn: "1" });
  assert.equal(first.counts[0].isFirstIn, false);

  const bool = newService();
  await bool.service.getOnePageList({ appKey: "k", url: "/a", isFirstIn: "true" });
  assert.equal(bool.counts[0].isFirstIn, true);
});

test("getOnePageList applies each time bound independently", async () => {
  const both = newService();
  await both.service.getOnePageList({
    appKey: "k",
    url: "/a",
    beginTime: "2026-11-01T00:00:00.000Z",
    endTime: "2026-11-02T00:00:00.000Z",
  });
  const createTime = both.counts[0].createTime as { $gte: Date; $lte: Date };
  assert.equal(createTime.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(createTime.$lte.toISOString(), "2026-11-02T00:00:00.000Z");

  const beginOnly = newService();
  await beginOnly.service.getOnePageList({ appKey: "k", url: "/a", beginTime: "2026-11-01T00:00:00.000Z" });
  const halfRange = beginOnly.counts[0].createTime as { $gte: Date; $lte?: Date };
  assert.equal(halfRange.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(halfRange.$lte, undefined, "a lone begin bound must not become a two-sided range");
});

test("getOnePageList paginates raw rows by recency", async () => {
  const { service, pipelines, reads } = newService({ count: 30, aggRows: [{}] });
  const result = await service.getOnePageList({ appKey: "k", url: "/a", type: "4", pageNo: 2, pageSize: 10 });
  assert.deepEqual(stageNames(pipelines[0]), ["$match", "$sort", "$skip", "$limit"]);
  assert.equal((pipelines[0][0].$match as Filter).speedType, 4);
  assert.deepEqual(pipelines[0][1].$sort, { createTime: -1 });
  assert.equal(pipelines[0][2].$skip, 10);
  assert.equal(pipelines[0][3].$limit, 10);
  assert.equal(result.totalNum, 30);
  assert.equal(result.pageNo, 2);
  assert.ok(reads.length > 0 && reads.every((mode) => mode === "secondaryPreferred"));
});

test("getPageDetails fetches by id within the appKey collection", async () => {
  const { service, findOnes, appKeys } = newService({ doc: { _id: "id1" } });
  const result = await service.getPageDetails("k", "id1");
  assert.deepEqual(findOnes[0], { _id: "id1" });
  assert.deepEqual(appKeys, ["k"]);
  assert.deepEqual(result, { _id: "id1" });
});
