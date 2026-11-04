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

test("an unparseable resource requestTime also falls back to the ingest time", async () => {
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
