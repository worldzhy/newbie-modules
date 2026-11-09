import assert from "node:assert/strict";
import { test } from "node:test";

import { EnvironmentService } from "./environment.service";

/**
 * Read-side contracts for EnvironmentService.getDataGroupBy: the url is always
 * part of the $match, the group key is selected by the type switch, and the
 * result is capped at 10 rows sorted by count descending.
 * getEnvironmentForPage is a pure pass-through (findOne by markPage) and is
 * intentionally not covered.
 */

type Pipeline = Record<string, unknown>[];

function buildService(result: unknown[] = []) {
  const calls: { appKey: string; pipeline: Pipeline; readMode?: string }[] = [];
  const models = {
    WebEnvironment: (appKey: string) => ({
      aggregate: (pipeline: Pipeline) => {
        const call: { appKey: string; pipeline: Pipeline; readMode?: string } = { appKey, pipeline };
        calls.push(call);
        return {
          read(mode: string) {
            call.readMode = mode;
            return { exec: async () => result };
          },
        };
      },
    }),
  };
  return { service: new EnvironmentService(models as never), calls };
}

test("type 1 groups by city, type 2 by browser, type 3 by system", async () => {
  const { service, calls } = buildService();
  await service.getDataGroupBy(1, "https://example.com/a", "app1");
  await service.getDataGroupBy(2, "https://example.com/a", "app1");
  await service.getDataGroupBy(3, "https://example.com/a", "app1");
  assert.deepEqual(calls[0].pipeline[1].$group, {
    _id: { url: "$url", city: "$city", browser: "", system: "" },
    count: { $sum: 1 },
  });
  assert.deepEqual((calls[1].pipeline[1].$group as Record<string, unknown>)._id, {
    url: "$url",
    city: "",
    browser: "$browser",
    system: "",
  });
  assert.deepEqual((calls[2].pipeline[1].$group as Record<string, unknown>)._id, {
    url: "$url",
    city: "",
    browser: "",
    system: "$system",
  });
});

test("an unknown type groups by url alone", async () => {
  const { service, calls } = buildService();
  await service.getDataGroupBy(99, "https://example.com/a", "app1");
  assert.deepEqual((calls[0].pipeline[1].$group as Record<string, unknown>)._id, {
    url: "$url",
    city: "",
    browser: "",
    system: "",
  });
});

test("the pipeline matches the url, sorts by count descending, and caps at 10 rows", async () => {
  const { service, calls } = buildService([{ _id: {}, count: 3 }]);
  const result = await service.getDataGroupBy(1, "https://example.com/a", "app1");
  assert.deepEqual(calls[0].pipeline[0], { $match: { url: "https://example.com/a" } });
  assert.deepEqual(calls[0].pipeline[2], { $sort: { count: -1 } });
  assert.deepEqual(calls[0].pipeline[3], { $limit: 10 });
  assert.equal(calls[0].readMode, "secondaryPreferred");
  assert.equal(calls[0].appKey, "app1", "the query must be scoped to the per-appKey collection");
  assert.deepEqual(result, [{ _id: {}, count: 3 }]);
});

test("each createTime bound is applied independently", async () => {
  const { service, calls } = buildService();
  await service.getDataGroupBy(1, "u", "app1", "2026-01-01T00:00:00.000Z");
  let match = calls[0].pipeline[0].$match as Record<string, unknown>;
  const beginOnly = match.createTime as { $gte: Date; $lte?: Date };
  assert.equal(beginOnly.$gte.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(beginOnly.$lte, undefined, "a lone begin bound must not become a two-sided range");
  await service.getDataGroupBy(1, "u", "app1", "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  match = calls[1].pipeline[0].$match as Record<string, unknown>;
  assert.deepEqual(match.createTime, {
    $gte: new Date("2026-01-01T00:00:00.000Z"),
    $lte: new Date("2026-01-02T00:00:00.000Z"),
  });
});
