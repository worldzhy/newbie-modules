import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";

import { FrontendMonitorReportController } from "./report.controller";
import { RedisKeys } from "../../models/enum";
import { FRONTEND_MONITOR_CONFIG } from "../../shared/frontend-monitor-config";

/**
 * Public ingest contract of FrontendMonitorReportController (ADR-016): the appKey always
 * comes from the resolved installation token and overwrites any
 * client-supplied value, malformed payloads are 400, an unknown appKey is
 * 400, a full redis queue is 429, and the happy path lpush'es the report and
 * counts the day.
 *
 * The queue limit (redis_consumption.total_limit_web) is a code constant in
 * shared/frontend-monitor-config.ts, not injectable — the tests drive the
 * controller at that fixed boundary.
 */

type Row = Record<string, unknown>;

const INSTALLATION = { installationId: "inst-1", appKey: "APP1" };

function harness(options: { site?: Row | null; listLength?: number } = {}) {
  const ops: string[] = [];
  const lpushCalls: Array<{ key: string; value: string }> = [];
  const redis = {
    getClient: () => ({
      llen: async (key: string) => {
        ops.push(`llen:${key}`);
        return options.listLength ?? 0;
      },
      lpush: async (key: string, value: string) => {
        ops.push(`lpush:${key}`);
        lpushCalls.push({ key, value });
        return 1;
      },
    }),
  };
  const siteCalls: string[] = [];
  const site = {
    getSiteForAppId: async (appKey: string) => {
      siteCalls.push(appKey);
      if (options.site === null) return null;
      return options.site ?? { appKey };
    },
  };
  const counted: string[] = [];
  const dayReportNum = {
    redisCount: async (appKey: string) => {
      ops.push(`redisCount:${appKey}`);
      counted.push(appKey);
    },
  };
  const touched: string[] = [];
  const tokenResolver = {
    touchOnReport: async (installationId: string) => {
      touched.push(installationId);
    },
  };
  const controller = new FrontendMonitorReportController(
    site as never,
    dayReportNum as never,
    redis as never,
    tokenResolver as never,
  );
  return { controller, ops, lpushCalls, siteCalls, counted, touched };
}

function req(headers: Record<string, string> = {}) {
  return {
    headers,
    ip: "10.0.0.1",
    installation: INSTALLATION,
  };
}

function lastPayload(h: ReturnType<typeof harness>): Row {
  return JSON.parse(h.lpushCalls.at(-1)?.value ?? "{}") as Row;
}

test("accepts a JSON string body posted as text/plain (sendBeacon)", async () => {
  const h = harness();
  const headers = { "content-type": "text/plain", "user-agent": "UA", referer: "https://x/home" };
  const result = await h.controller.webReport(
    req(headers) as never,
    headers,
    JSON.stringify({ url: "https://x/home", type: "PagePerf" }) as never,
  );
  assert.equal(result, "ok");
  assert.equal(lastPayload(h).type, "PagePerf");
});

test("accepts an object body", async () => {
  const h = harness();
  const headers = { "user-agent": "UA" };
  const result = await h.controller.webReport(req(headers) as never, headers, { type: "Error" } as never);
  assert.equal(result, "ok");
  assert.equal(lastPayload(h).type, "Error");
});

test("rejects an unparseable string body before any side effect", async () => {
  const h = harness();
  await assert.rejects(
    () => h.controller.webReport(req() as never, {}, "{nope" as never),
    (error) => error instanceof BadRequestException && error.message === "Invalid report payload",
  );
  assert.equal(h.touched.length, 0, "the liveness touch only runs on a parsed payload");
  assert.equal(h.lpushCalls.length, 0);
});

test("rejects a payload that parses to a non-object", async () => {
  const h = harness();
  for (const body of ['"just a string"', "null"]) {
    await assert.rejects(
      () => h.controller.webReport(req() as never, {}, body as never),
      (error) => error instanceof BadRequestException && error.message === "Invalid report payload",
    );
  }
  assert.equal(h.lpushCalls.length, 0);
});

test("an object body under a text/plain content type is accepted as-is", async () => {
  const h = harness();
  const headers = { "content-type": "text/plain" };
  const result = await h.controller.webReport(req(headers) as never, headers, { type: "PagePerf" } as never);
  assert.equal(result, "ok");
  assert.equal(lastPayload(h).type, "PagePerf");
});

test("a client-supplied appKey is overwritten by the token's appKey", async () => {
  const h = harness();
  const headers = { "user-agent": "UA" };
  await h.controller.webReport(req(headers) as never, headers, { appKey: "EVIL", type: "PagePerf" } as never);
  assert.deepEqual(h.siteCalls, ["APP1"], "the site lookup uses the token appKey");
  assert.equal(lastPayload(h).appKey, "APP1", "the queued payload carries the token appKey");
  assert.deepEqual(h.counted, ["APP1"]);
});

test("the client ip resolves from x-real-ip, then the x-forwarded-for first hop, then the socket ip", async () => {
  const withRealIp = harness();
  let headers: Record<string, string> = { "x-real-ip": "1.1.1.1" };
  await withRealIp.controller.webReport(req(headers) as never, headers, {} as never);
  assert.equal(lastPayload(withRealIp).ip, "1.1.1.1");

  const withForwarded = harness();
  headers = { "x-forwarded-for": "2.2.2.2, 10.0.0.1" };
  await withForwarded.controller.webReport(req(headers) as never, headers, {} as never);
  assert.equal(lastPayload(withForwarded).ip, "2.2.2.2", "the first hop is the original client");

  const withSocket = harness();
  await withSocket.controller.webReport(req() as never, {}, {} as never);
  assert.equal(lastPayload(withSocket).ip, "10.0.0.1");
});

test("a missing url falls back to the referer and the user agent is tagged", async () => {
  const h = harness();
  const headers = { referer: "https://x/landing", "user-agent": "Mozilla/5.0" };
  await h.controller.webReport(req(headers) as never, headers, {} as never);
  assert.equal(lastPayload(h).url, "https://x/landing");
  assert.equal(lastPayload(h).userAgent, "Mozilla/5.0");
});

test("an appKey with no registered site is rejected", async () => {
  const h = harness({ site: null });
  await assert.rejects(
    () => h.controller.webReport(req() as never, {}, {} as never),
    (error) => error instanceof BadRequestException && error.message === "appKey: does not exist",
  );
  assert.equal(h.lpushCalls.length, 0);
});

test("a full redis queue throttles with 429 before any push", async () => {
  const limit = FRONTEND_MONITOR_CONFIG.redis_consumption.total_limit_web;
  const h = harness({ listLength: limit });
  await assert.rejects(
    () => h.controller.webReport(req() as never, {}, {} as never),
    (error) =>
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.TOO_MANY_REQUESTS &&
      error.message === `redis: ${RedisKeys.FRONTEND_REPORT_DATAS}: rate limit reached (${limit})`,
  );
  assert.equal(h.lpushCalls.length, 0);
  assert.equal(h.counted.length, 0);
});

test("one slot below the limit still accepts the report", async () => {
  const h = harness({ listLength: FRONTEND_MONITOR_CONFIG.redis_consumption.total_limit_web - 1 });
  const result = await h.controller.webReport(req() as never, {}, {} as never);
  assert.equal(result, "ok");
  assert.equal(h.lpushCalls.length, 1);
});

test("the happy path touches liveness, pushes the report and counts the day in order", async () => {
  const h = harness();
  const headers = { "user-agent": "UA" };
  await h.controller.webReport(req(headers) as never, headers, { type: "PagePerf" } as never);
  assert.deepEqual(h.touched, ["inst-1"]);
  assert.deepEqual(h.ops, [
    `llen:${RedisKeys.FRONTEND_REPORT_DATAS}`,
    `lpush:${RedisKeys.FRONTEND_REPORT_DATAS}`,
    "redisCount:APP1",
  ]);
});
