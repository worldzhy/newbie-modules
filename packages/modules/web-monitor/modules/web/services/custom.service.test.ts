import assert from "node:assert/strict";
import { test } from "node:test";

import { WebCustomService } from "./custom.service";

/**
 * Read-side contracts for WebCustomService: user-supplied search text must be
 * regex-escaped before it reaches a $regex stage, pagination math must coerce
 * string inputs, and the count and page queries must share one filter object.
 */

type Filter = Record<string, unknown>;

interface ListChain {
  sort?: unknown;
  readMode?: string;
}

function fakeFilterModel(opts: {
  listRows?: unknown[] | null;
  findOneResult?: unknown;
  findOneError?: Error;
  deleteOneError?: Error;
}) {
  const saved: Filter[] = [];
  const deleted: Filter[] = [];
  const listChain: ListChain = {};
  class FakeFilter {
    [key: string]: unknown;
    async save() {
      saved.push({ appKey: this.appKey, filterKey: this.filterKey, filterDesc: this.filterDesc });
      return this;
    }
    static find() {
      const q: Record<string, unknown> = {};
      q.sort = (s: unknown) => {
        listChain.sort = s;
        return q;
      };
      q.read = (mode: string) => {
        listChain.readMode = mode;
        return q;
      };
      q.exec = async () => (opts.listRows === undefined ? [] : opts.listRows);
      return q;
    }
    static findOne(_filter: Filter) {
      return {
        exec: async () => {
          if (opts.findOneError) throw opts.findOneError;
          return opts.findOneResult ?? null;
        },
      };
    }
    static deleteOne(filter: Filter) {
      deleted.push(filter);
      return {
        exec: async () => {
          if (opts.deleteOneError) throw opts.deleteOneError;
          return { deletedCount: 1 };
        },
      };
    }
  }
  return { FakeFilter, saved, deleted, listChain };
}

interface CustomCalls {
  countFilter?: Filter;
  findFilter?: Filter;
  skip?: number;
  limit?: number;
  sort?: unknown;
}

function fakeWebCustom(opts: { total?: number; rows?: unknown[] }) {
  const calls: CustomCalls = {};
  const model = {
    count(filter: Filter) {
      calls.countFilter = filter;
      return { read: (_mode: string) => ({ exec: async () => opts.total ?? 0 }) };
    },
    find(filter: Filter) {
      calls.findFilter = filter;
      const q: Record<string, unknown> = {};
      q.skip = (n: number) => {
        calls.skip = n;
        return q;
      };
      q.limit = (n: number) => {
        calls.limit = n;
        return q;
      };
      q.sort = (s: unknown) => {
        calls.sort = s;
        return q;
      };
      q.read = (_mode: string) => q;
      q.exec = async () => opts.rows ?? [];
      return q;
    },
  };
  return { model, calls };
}

function buildService(
  opts: {
    listRows?: unknown[] | null;
    findOneResult?: unknown;
    findOneError?: Error;
    deleteOneError?: Error;
    total?: number;
    rows?: unknown[];
  } = {},
) {
  const filter = fakeFilterModel(opts);
  const custom = fakeWebCustom(opts);
  const models = {
    WebCustomFilter: (_appKey: string) => filter.FakeFilter,
    WebCustom: (_appKey: string) => custom.model,
  };
  return { service: new WebCustomService(models as never), filter, custom };
}

test("getCustomFilterList sorts newest first and wraps rows", async () => {
  const { service, filter } = buildService({ listRows: [{ filterKey: "a" }] });
  assert.deepEqual(await service.getCustomFilterList("app1"), { list: [{ filterKey: "a" }] });
  assert.deepEqual(filter.listChain.sort, { createTime: -1 });
  assert.equal(filter.listChain.readMode, "secondaryPreferred");
});

test("getCustomFilterList normalizes a null store result to an empty list", async () => {
  const { service } = buildService({ listRows: null });
  assert.deepEqual(await service.getCustomFilterList("app1"), { list: [] });
});

test("addCustomFilter validates filterKey before appKey before filterDesc", async () => {
  const { service } = buildService();
  // Positional signature: (appKey, filterKey, filterDesc); an empty appKey
  // still reports filterKey first because that check runs earlier.
  await assert.rejects(service.addCustomFilter("", "", ""), { message: "Add filter: filterKey must not be empty" });
  await assert.rejects(service.addCustomFilter("", "k", ""), { message: "Add filter: appKey must not be empty" });
  await assert.rejects(service.addCustomFilter("app1", "k", ""), {
    message: "Add filter: filterDesc must not be empty",
  });
});

test("addCustomFilter rejects a duplicate filterKey", async () => {
  const { service } = buildService({ findOneResult: { filterKey: "k" } });
  await assert.rejects(service.addCustomFilter("app1", "k", "d"), { message: "Add filter: filterKey already exists" });
});

test("addCustomFilter persists appKey, filterKey, and filterDesc", async () => {
  const { service, filter } = buildService();
  assert.equal(await service.addCustomFilter("app1", "k", "d"), true);
  assert.deepEqual(filter.saved, [{ appKey: "app1", filterKey: "k", filterDesc: "d" }]);
});

test("delCustomFilter rejects empty id and appKey", async () => {
  const { service } = buildService();
  await assert.rejects(service.delCustomFilter("app1", ""), { message: "Delete filter: _id must not be empty" });
  await assert.rejects(service.delCustomFilter("", "id1"), { message: "Delete filter: appKey must not be empty" });
});

test("delCustomFilter maps a lookup failure to a not-exist error", async () => {
  const { service } = buildService({ findOneError: new Error("CastError") });
  await assert.rejects(service.delCustomFilter("app1", "bad-id"), { message: "Delete filter: _id does not exist" });
});

test("delCustomFilter maps a delete failure to a deletion-failed error", async () => {
  const { service } = buildService({ findOneResult: { _id: "id1" }, deleteOneError: new Error("write concern") });
  await assert.rejects(service.delCustomFilter("app1", "id1"), { message: "Delete filter: deletion failed" });
});

test("delCustomFilter deletes by _id on success", async () => {
  const { service, filter } = buildService({ findOneResult: { _id: "id1" } });
  assert.equal(await service.delCustomFilter("app1", "id1"), true);
  assert.deepEqual(filter.deleted, [{ _id: "id1" }]);
});

test("getAverageCustomList regex-escapes user-supplied customName", async () => {
  const { service, custom } = buildService();
  await service.getAverageCustomList("app1", 1, 10, undefined, undefined, "a.b(c)*[x]");
  const customName = (custom.calls.findFilter as Filter).customName as Filter;
  assert.equal(customName.$regex, "a\\.b\\(c\\)\\*\\[x\\]", "regex metacharacters must never reach Mongo unescaped");
  assert.equal(customName.$options, "i");
});

test("getAverageCustomList regex-escapes customFilter values and skips empty ones", async () => {
  const { service, custom } = buildService();
  await service.getAverageCustomList("app1", 1, 10, undefined, undefined, undefined, {
    region: "a.b*",
    empty: "",
    nil: null,
    undef: undefined,
  });
  const filter = custom.calls.findFilter as Filter;
  assert.deepEqual(filter["customFilter.region"], { $regex: "a\\.b\\*", $options: "i" });
  assert.ok(!("customFilter.empty" in filter));
  assert.ok(!("customFilter.nil" in filter));
  assert.ok(!("customFilter.undef" in filter));
});

test("getAverageCustomList ignores a non-plain-object customFilter", async () => {
  const { service, custom } = buildService();
  await service.getAverageCustomList("app1", 1, 10, undefined, undefined, undefined, ["x"] as never);
  const filter = custom.calls.findFilter as Filter;
  assert.deepEqual(filter, {}, "an array must not leak into customFilter.* keys");
});

test("getAverageCustomList applies single-sided and two-sided time bounds", async () => {
  const { service, custom } = buildService();
  await service.getAverageCustomList("app1", 1, 10, "2026-01-01T00:00:00.000Z");
  let createTime = (custom.calls.findFilter as Filter).createTime as Filter;
  assert.deepEqual(createTime.$gte, new Date("2026-01-01T00:00:00.000Z"));
  assert.ok(!("$lte" in createTime));
  await service.getAverageCustomList("app1", 1, 10, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  createTime = (custom.calls.findFilter as Filter).createTime as Filter;
  assert.deepEqual(createTime, {
    $gte: new Date("2026-01-01T00:00:00.000Z"),
    $lte: new Date("2026-01-02T00:00:00.000Z"),
  });
});

test("getAverageCustomList shares one filter between count and find, newest first", async () => {
  const { service, custom } = buildService({ total: 3, rows: [{ id: 1 }] });
  await service.getAverageCustomList("app1", 1, 10, undefined, undefined, "abc");
  assert.equal(custom.calls.countFilter, custom.calls.findFilter, "count and page must see the same filter");
  assert.deepEqual(custom.calls.sort, { createTime: -1 });
});

test("getAverageCustomList computes skip from pageNo and pageSize and coerces string inputs", async () => {
  const { service, custom } = buildService({ total: 42, rows: [{ id: 1 }] });
  const result = await service.getAverageCustomList("app1", "3" as never, "20" as never);
  assert.equal(custom.calls.skip, 40);
  assert.equal(custom.calls.limit, 20);
  assert.equal(result.totalNum, 42);
  assert.deepEqual(result.dataList, [{ id: 1 }]);
  assert.equal(result.pageNo, 3, "the echoed pageNo must be a number even when the input was a string");
});
