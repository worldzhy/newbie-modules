import assert from "node:assert/strict";
import test from "node:test";
import { ResourceService } from "./resource.service";

type Filter = Record<string, unknown>;
type Pipeline = Record<string, unknown>[];

function newService(opts: { count?: number; aggRows?: unknown[]; distinctValues?: string[]; doc?: unknown } = {}) {
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
    WebResource: (appKey: string) => {
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
  const config = { get: () => ({}) };
  return {
    service: new ResourceService(models as never, config as never),
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

test("getResourceForType scopes the match to url and a numeric speedType", async () => {
  const { service, counts, pipelines, appKeys } = newService();
  await service.getResourceForType("k", "/a.png", 4, 1, 15);
  assert.deepEqual(appKeys, ["k", "k"]);
  assert.deepEqual(counts[0], { url: "/a.png", speedType: 4 });
  assert.deepEqual(pipelines[0][0].$match, { url: "/a.png", speedType: 4 });
});

test("getResourceForType applies each time bound independently", async () => {
  const both = newService();
  await both.service.getResourceForType("k", "/a", 1, 1, 15, "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z");
  const createTime = both.counts[0].createTime as { $gte: Date; $lte: Date };
  assert.equal(createTime.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(createTime.$lte.toISOString(), "2026-11-02T00:00:00.000Z");

  const beginOnly = newService();
  await beginOnly.service.getResourceForType("k", "/a", 1, 1, 15, "2026-11-01T00:00:00.000Z");
  const halfRange = beginOnly.counts[0].createTime as { $gte: Date; $lte?: Date };
  assert.equal(halfRange.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(halfRange.$lte, undefined, "a lone begin bound must not become a two-sided range");
});

test("getResourceForType orders by recency inside skip/limit pagination", async () => {
  const { service, pipelines, reads } = newService({ count: 42, aggRows: [{ name: "/a" }] });
  const result = await service.getResourceForType("k", "/a", 1, 3, 10);
  assert.deepEqual(stageNames(pipelines[0]), ["$match", "$sort", "$skip", "$limit"]);
  assert.deepEqual(pipelines[0][1].$sort, { createTime: -1 });
  assert.equal(pipelines[0][2].$skip, 20);
  assert.equal(pipelines[0][3].$limit, 10);
  assert.equal(result.totalNum, 42);
  assert.equal(result.pageNo, 3);
  assert.ok(reads.length > 0 && reads.every((mode) => mode === "secondaryPreferred"));
});

test("getAverageResourceList escapes user search text before compiling the regex", async () => {
  const { service, pipelines } = newService();
  await service.getAverageResourceList({ appKey: "k", url: "a.*(b)" });
  const match = pipelines[0][0].$match as Filter;
  const regex = (match.name as { $regex: RegExp }).$regex;
  assert.ok(regex instanceof RegExp);
  assert.equal(regex.source, "a\\.\\*\\(b\\)", "metacharacters must be escaped, never compiled raw");
  assert.ok(regex.flags.includes("i"));
  assert.ok(regex.test("a.*(b)"), "the escaped regex still matches the literal text");
  assert.ok(!regex.test("aXXb"), "metacharacters must not act as a pattern");
});

test("getAverageResourceList supports single-sided time bounds", async () => {
  const beginOnly = newService();
  await beginOnly.service.getAverageResourceList({ appKey: "k", beginTime: "2026-11-01T00:00:00.000Z" });
  const beginTime = beginOnly.distincts[0].match.createTime as { $gte: Date; $lte?: Date };
  assert.equal(beginTime.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(beginTime.$lte, undefined);

  const endOnly = newService();
  await endOnly.service.getAverageResourceList({ appKey: "k", endTime: "2026-11-02T00:00:00.000Z" });
  const endTime = endOnly.distincts[0].match.createTime as { $gte?: Date; $lte: Date };
  assert.equal(endTime.$gte, undefined);
  assert.equal(endTime.$lte.toISOString(), "2026-11-02T00:00:00.000Z");
});

test("getAverageResourceList groups by name and method and totals via distinct names", async () => {
  const { service, pipelines, distincts } = newService({ distinctValues: ["/a", "/b"], aggRows: [{}, {}] });
  const result = await service.getAverageResourceList({ appKey: "k", pageNo: 2, pageSize: 10 });
  assert.equal(distincts[0].field, "name");
  assert.deepEqual((pipelines[0][1].$group as Filter)._id, { url: "$name", method: "$method" });
  assert.deepEqual(stageNames(pipelines[0]), ["$match", "$group", "$skip", "$limit", "$sort"]);
  assert.deepEqual(pipelines[0][4].$sort, { count: -1 });
  assert.equal(pipelines[0][2].$skip, 10);
  assert.equal(pipelines[0][3].$limit, 10);
  assert.equal(result.totalNum, 2, "totalNum is the number of distinct names");
  assert.equal(result.pageNo, 2);
});

test("getAverageResourceList coerces the type filter to a numeric speedType", async () => {
  const { service, distincts } = newService();
  await service.getAverageResourceList({ appKey: "k", type: "4" });
  assert.deepEqual(distincts[0].match, { speedType: 4 });
});

test("getOneResourceAvg groups the whole match into a single row and tolerates empties", async () => {
  const empty = newService({ aggRows: [] });
  assert.deepEqual(await empty.service.getOneResourceAvg("k", "/a"), {});

  const withRow = newService({ aggRows: [{ count: 3, duration: 9 }] });
  const result = await withRow.service.getOneResourceAvg(
    "k",
    "/a",
    "2026-11-01T00:00:00.000Z",
    "2026-11-02T00:00:00.000Z",
  );
  assert.deepEqual(result, { count: 3, duration: 9 });
  const pipeline = withRow.pipelines[0];
  assert.equal((pipeline[0].$match as Filter).name, "/a");
  assert.ok((pipeline[0].$match as Filter).createTime, "both bounds must build the time range");
  assert.equal((pipeline[1].$group as Filter)._id, null);
});

test("getOneResourceList paginates the raw rows by recency", async () => {
  const { service, counts, pipelines } = newService({ count: 30, aggRows: [{}] });
  const result = await service.getOneResourceList("k", "/a", 2, 10);
  assert.deepEqual(counts[0], { name: "/a" });
  assert.deepEqual(stageNames(pipelines[0]), ["$match", "$sort", "$skip", "$limit"]);
  assert.deepEqual(pipelines[0][1].$sort, { createTime: -1 });
  assert.equal(pipelines[0][2].$skip, 10);
  assert.equal(pipelines[0][3].$limit, 10);
  assert.equal(result.totalNum, 30);
  assert.equal(result.pageNo, 2);
});

test("getOneResourceDetail fetches by id within the appKey collection", async () => {
  const { service, findOnes, appKeys } = newService({ doc: { _id: "id1" } });
  const result = await service.getOneResourceDetail("k", "id1");
  assert.deepEqual(findOnes[0], { _id: "id1" });
  assert.deepEqual(appKeys, ["k"]);
  assert.deepEqual(result, { _id: "id1" });
});
