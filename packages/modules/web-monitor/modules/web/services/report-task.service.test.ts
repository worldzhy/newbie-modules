import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigService } from "@nestjs/config";
import { ReportType } from "../../../models/enum";
import { WebReportTaskService } from "./report-task.service";

/**
 * R9-01: `time` arrives from the public SDK payload and was never validated.
 * `func.toDate` turns an unparseable value into `Invalid Date`, every drain
 * row carried that value, the store write failed deterministically, and the
 * raw payload was pushed back to Redis forever — a poison pill reachable by
 * anyone holding the public installation token.
 *
 * Invariant encoded here: a client-supplied timestamp must never reach a
 * bucket as an invalid `Date`. An unparseable value falls back to the ingest
 * time (the service comment says "loss is not acceptable"), so the item is
 * still persisted and no requeue loop can form.
 */

const VALID_APP_ID = "Valid_App1";

function emptyBuckets() {
  return {
    appAjaxs: {},
    appErrors: {},
    appPages: {},
    appEnvironments: {},
    appResources: {},
    appCustoms: {},
    sdkErrors: [],
  };
}

function buildService() {
  const config = { get: () => ({}) } as unknown as ConfigService;
  const redis = {} as never;
  const site = {
    getSiteForAppId: async () => ({ appId: VALID_APP_ID, slowPageTime: 5 }),
  } as never;
  const models = {} as never;
  const ch = {} as never;
  return new WebReportTaskService(config, redis, site, models, ch);
}

type DrainResult = string | null;

function drain(service: WebReportTaskService, raw: Record<string, unknown>, buckets: ReturnType<typeof emptyBuckets>) {
  const target = service as unknown as {
    collectQueueItem: (payload: string, buckets: unknown) => Promise<DrainResult>;
  };
  return target.collectQueueItem(JSON.stringify(raw), buckets);
}

function collectRows(buckets: ReturnType<typeof emptyBuckets>) {
  return [
    ...Object.values(buckets.appAjaxs).flat(),
    ...Object.values(buckets.appErrors).flat(),
    ...Object.values(buckets.appPages).flat(),
    ...Object.values(buckets.appEnvironments).flat(),
    ...Object.values(buckets.appResources).flat(),
    ...Object.values(buckets.appCustoms).flat(),
  ] as Record<string, unknown>[];
}

function assertValidDates(buckets: ReturnType<typeof emptyBuckets>, earliest = 0) {
  const rows = collectRows(buckets);
  for (const row of rows) {
    const createTime = row.createTime;
    assert.ok(createTime instanceof Date, "drain row must carry a Date createTime");
    const time = (createTime as Date).getTime();
    assert.ok(!Number.isNaN(time), `drain emitted an invalid createTime on row: ${JSON.stringify(row)}`);
    assert.ok(time >= earliest, `fallback must be the ingest time, got ${createTime as unknown as string}`);
  }
  return rows.length;
}

test("unparseable time falls back to the ingest time instead of an invalid date", async () => {
  const buckets = emptyBuckets();
  const before = Date.now();
  const outcome = await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.PagePerf,
      time: "not-a-date",
      url: "https://example.com/a",
      markPage: "p1",
    },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "the item must still be persisted, not dropped");
  assert.ok(assertValidDates(buckets, before) > 0, "a page-performance item must produce at least one row");
});

test("omitted time falls back to the ingest time instead of an invalid date", async () => {
  const buckets = emptyBuckets();
  const before = Date.now();
  const outcome = await drain(
    buildService(),
    { appId: VALID_APP_ID, type: ReportType.PagePerf, time: undefined, url: "https://example.com/a", markPage: "p1" },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "the item must still be persisted, not dropped");
  assert.ok(assertValidDates(buckets, before) > 0, "a page-performance item must produce at least one row");
});

test("an unparseable ajax requestTime also falls back to the ingest time (saveAjaxs branch)", async () => {
  const buckets = emptyBuckets();
  const before = Date.now();
  const outcome = await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.AjaxPerf,
      time: "not-a-date",
      url: "https://example.com/a",
      resourceList: [{ type: "fetch", name: "https://example.com/x", requestTime: "not-a-date" }],
    },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "the item must still be persisted, not dropped");
  assert.ok(assertValidDates(buckets, before) > 0, "an ajax item must produce at least one row");
});

test("an unparseable slow-resource requestTime also falls back to the ingest time (collectResource branch)", async () => {
  const buckets = emptyBuckets();
  const before = Date.now();
  const outcome = await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.AjaxPerf,
      time: "not-a-date",
      url: "https://example.com/a",
      // Non-ajax type routes through collectResource; duration must clear the
      // 2s default slowTime or no row is produced at all.
      resourceList: [{ type: "img", name: "https://example.com/x.png", duration: 5000, requestTime: "not-a-date" }],
    },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "the item must still be persisted, not dropped");
  const resources = Object.values(buckets.appResources).flat() as Record<string, unknown>[];
  assert.ok(resources.length > 0, "a slow img resource must produce a resource row");
  assert.ok(assertValidDates(buckets, before) > 0, "resource rows must carry valid dates");
});

test("an unparseable error createTime also falls back to the ingest time (collectErrors branch)", async () => {
  const buckets = emptyBuckets();
  const before = Date.now();
  const outcome = await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.Error,
      time: "not-a-date",
      url: "https://example.com/a",
      errorList: [{ createTime: "not-a-date", msg: "boom" }],
    },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "the item must still be persisted, not dropped");
  const errors = Object.values(buckets.appErrors).flat() as Record<string, unknown>[];
  assert.ok(errors.length > 0, "an error item must produce an error row");
  assert.ok(assertValidDates(buckets, before) > 0, "error rows must carry valid dates");
});

test("a parseable time still flows through and keeps its timestamp", async () => {
  const buckets = emptyBuckets();
  const iso = "2026-11-05T01:02:03.000Z";
  const outcome = await drain(
    buildService(),
    { appId: VALID_APP_ID, type: ReportType.PagePerf, time: iso, url: "https://example.com/a", markPage: "p1" },
    buckets,
  );
  assert.equal(outcome, VALID_APP_ID, "a valid item must still be processed");
  assert.ok(assertValidDates(buckets) > 0, "a page-performance item must produce at least one row");
  const page = Object.values(buckets.appPages).flat()[0] as Record<string, unknown>;
  assert.equal((page.createTime as Date).toISOString(), iso);
});

/**
 * R12-01: Client-supplied non-numeric strings/objects on numeric fields were
 * cast by Mongoose at insert time — "abc" → CastError → flush requeue loop →
 * the same item returns forever, other apps' reports get rate-limited out.
 *
 * Invariant: a page-performance row must never carry a non-finite numeric
 * field. Invalid values are skipped entirely so Mongo $avg correctly ignores
 * missing keys instead of averaging in a poisoned 0.
 */

function collectPageRow(buckets: ReturnType<typeof emptyBuckets>) {
  return (Object.values(buckets.appPages).flat()[0] as Record<string, unknown>) ?? {};
}
function collectCustomRow(buckets: ReturnType<typeof emptyBuckets>) {
  return (Object.values(buckets.appCustoms).flat()[0] as Record<string, unknown>) ?? {};
}
function collectResourceRows(buckets: ReturnType<typeof emptyBuckets>) {
  return Object.values(buckets.appResources).flat() as Record<string, unknown>[];
}
function collectAjaxRows(buckets: ReturnType<typeof emptyBuckets>) {
  return Object.values(buckets.appAjaxs).flat() as Record<string, unknown>[];
}

test("poison string screenWidth is skipped instead of cast to NaN", async () => {
  const buckets = emptyBuckets();
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.PagePerf,
      url: "https://example.com/a",
      markPage: "p1",
      isFirstIn: true,
      screenWidth: "abc",
      screenHeight: 900,
    },
    buckets,
  );
  const page = collectPageRow(buckets);
  // Invalid screenWidth must not be present in the row at all.
  assert.ok(!("screenWidth" in page), "poison screenWidth must be absent, not 0 or NaN");
  // Valid screenHeight still flows through.
  assert.equal(page.screenHeight, 900);
});

test("poison performance metrics are skipped instead of cast to NaN", async () => {
  const buckets = emptyBuckets();
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.PagePerf,
      url: "https://example.com/a",
      markPage: "p1",
      isFirstIn: true,
      performance: { wit: "abc", lodt: "def", dnst: 50 },
    },
    buckets,
  );
  const page = collectPageRow(buckets);
  assert.ok(!("whiteTime" in page), "poison whiteTime (wit) must be absent");
  assert.ok(!("loadTime" in page), "poison loadTime (lodt) must be absent");
  assert.equal(page.dnsTime, 50, "valid dnsTime still flows through");
});

test("object customContent is JSON-stringified instead of cast error", async () => {
  const buckets = emptyBuckets();
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.Custom,
      customs: [{ customName: "c1", customContent: { foo: "bar" } }],
    },
    buckets,
  );
  const custom = collectCustomRow(buckets);
  assert.equal(typeof custom.customContent, "string", "object customContent must become a string");
  assert.equal(custom.customContent, JSON.stringify({ foo: "bar" }));
});

test("poison bodySize on slow resource is skipped instead of cast to NaN", async () => {
  const buckets = emptyBuckets();
  // duration must exceed 2s default slowTime for a resource row to be emitted.
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.AjaxPerf,
      url: "https://example.com/a",
      resourceList: [{ type: "img", name: "https://example.com/x.png", duration: 5000, bodySize: "abc" }],
    },
    buckets,
  );
  const resources = collectResourceRows(buckets);
  assert.ok(resources.length > 0, "a slow img must produce a resource row");
  const r = resources[0];
  assert.ok(!("bodySize" in r), "poison resource bodySize must be absent");
  assert.equal(r.duration, 5000, "valid duration still flows through");
});

test("poison bodySize on ajax row is skipped instead of cast to NaN", async () => {
  const buckets = emptyBuckets();
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.AjaxPerf,
      url: "https://example.com/a",
      resourceList: [{ type: "fetch", name: "https://example.com/x", duration: 300, bodySize: "abc" }],
    },
    buckets,
  );
  const ajaxs = collectAjaxRows(buckets);
  assert.ok(ajaxs.length > 0, "an ajax row must be emitted");
  const a = ajaxs[0];
  assert.ok(!("bodySize" in a), "poison ajax bodySize must be absent from the row");
});

test("valid numeric strings still coerce correctly", async () => {
  const buckets = emptyBuckets();
  await drain(
    buildService(),
    {
      appId: VALID_APP_ID,
      type: ReportType.PagePerf,
      url: "https://example.com/a",
      markPage: "p1",
      isFirstIn: true,
      screenWidth: "1920",
      performance: { wit: "1500", lodt: "3000" },
    },
    buckets,
  );
  const page = collectPageRow(buckets);
  assert.equal(page.screenWidth, 1920);
  assert.equal(page.whiteTime, 1500);
  assert.equal(page.loadTime, 3000);
});
