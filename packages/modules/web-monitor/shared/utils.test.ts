import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  APP_KEY_PATTERN,
  assertAppKey,
  func,
  getRandomIp,
  isValidAppKey,
  mapWithConcurrency,
  pickRequestId,
} from "./utils";

/**
 * Behavior-level tests for the web-monitor shared utils. The invariants that
 * matter: appKey is a storage partition key and must be rejected at the
 * boundary; request id resolution must match the authorization guard's
 * precedence; client-supplied timestamps/numbers/strings must be coerced
 * defensively so poison values can never reach a store write.
 */

test("APP_KEY_PATTERN is the documented identifier-safe set", () => {
  assert.equal(APP_KEY_PATTERN.test("Abc_123"), true);
  assert.equal(APP_KEY_PATTERN.test("has-dash"), false);
});

test("isValidAppKey accepts identifier-safe values at the length boundaries", () => {
  assert.equal(isValidAppKey("a"), true);
  assert.equal(isValidAppKey("A0_"), true);
  assert.equal(isValidAppKey("x".repeat(64)), true, "64 characters is the inclusive upper bound");
});

test("isValidAppKey rejects unsafe characters, over-length and non-strings", () => {
  assert.equal(isValidAppKey(""), false);
  assert.equal(isValidAppKey("x".repeat(65)), false);
  assert.equal(isValidAppKey("has-dash"), false);
  assert.equal(isValidAppKey("has.dot"), false);
  assert.equal(isValidAppKey("has space"), false);
  assert.equal(isValidAppKey(42), false);
  assert.equal(isValidAppKey(undefined), false);
});

test("assertAppKey returns a valid appKey and throws BadRequestException otherwise", () => {
  assert.equal(assertAppKey("Valid_App1"), "Valid_App1");
  assert.throws(
    () => assertAppKey("bad-key"),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test("pickRequestId prefers params over query and body", () => {
  const req = { params: { id: "p" }, query: { id: "q" }, body: { id: "b" } };
  assert.equal(pickRequestId(req, "id"), "p");
});

test("pickRequestId falls back to query and then to body", () => {
  assert.equal(pickRequestId({ query: { id: "q" }, body: { id: "b" } }, "id"), "q");
  assert.equal(pickRequestId({ body: { id: "b" } }, "id"), "b");
});

test("pickRequestId rejects non-string and empty values", () => {
  assert.equal(pickRequestId({ params: { id: 42 } }, "id"), undefined);
  assert.equal(pickRequestId({ params: { id: "" } }, "id"), undefined);
  assert.equal(pickRequestId({ params: { id: ["a"] } }, "id"), undefined);
  assert.equal(pickRequestId({}, "id"), undefined);
});

test("pickRequestId does not fall through when an earlier source holds a non-string", () => {
  const req = { params: { id: 42 }, query: { id: "q" } };
  assert.equal(pickRequestId(req, "id"), undefined, "a poisoned params value must shadow the query");
});

test("isSkipIp skips loopback, mapped and empty ips", () => {
  assert.equal(func.isSkipIp(undefined), true);
  assert.equal(func.isSkipIp(""), true);
  assert.equal(func.isSkipIp("127.0.0.1"), true);
  assert.equal(func.isSkipIp("::1"), true);
  assert.equal(func.isSkipIp("::ffff:10.0.0.1"), true);
  assert.equal(func.isSkipIp("prefix-127.0.0.1-suffix"), true);
});

test("isSkipIp keeps regular client ips", () => {
  assert.equal(func.isSkipIp("8.8.8.8"), false);
});

test("format renders a fully padded date-time pattern", () => {
  const date = new Date(2026, 10, 9, 15, 4, 5); // 2026-11-09 15:04:05 local time
  assert.equal(func.format(date, "yyyy-MM-dd hh:mm:ss"), "2026-11-09 15:04:05");
});

test("format renders unpadded single-letter patterns", () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(func.format(date, "yyyy-M-d h:m:s"), "2026-1-2 3:4:5");
});

test("getRealIp prefers x-real-ip over x-forwarded-for and the socket ip", () => {
  const headers = { "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" };
  assert.equal(func.getRealIp(headers, "3.3.3.3"), "1.1.1.1");
});

test("getRealIp takes the first hop of x-forwarded-for", () => {
  const headers = { "x-forwarded-for": "1.1.1.1, 10.0.0.1, 172.16.0.1" };
  assert.equal(func.getRealIp(headers, "3.3.3.3"), "1.1.1.1");
});

test("getRealIp falls back to the socket ip when no header is usable", () => {
  assert.equal(func.getRealIp({}, "3.3.3.3"), "3.3.3.3");
  assert.equal(func.getRealIp({ "x-real-ip": "" }, "3.3.3.3"), "3.3.3.3");
  assert.equal(func.getRealIp({ "x-real-ip": ["1.1.1.1"] }, undefined), undefined);
});

test("urlHelper masks numeric path segments with *", () => {
  assert.equal(func.urlHelper("https://example.com/user/123/profile/456"), "https://example.com/user/*/profile/*");
  assert.equal(func.urlHelper("/user/789/orders"), "/user/*/orders");
  assert.equal(func.urlHelper("https://example.com:8080/a/1"), "https://example.com:8080/a/*");
});

test("urlHelper leaves non-numeric segments and path-less urls untouched", () => {
  assert.equal(func.urlHelper("https://example.com/user/abc"), "https://example.com/user/abc");
  assert.equal(func.urlHelper("https://example.com"), "https://example.com");
  assert.equal(func.urlHelper("/user/123abc"), "/user/123abc", "an alphanumeric segment is not a numeric id");
});

test("urlHelper never throws on malformed input", () => {
  assert.equal(func.urlHelper(undefined), "");
  assert.equal(func.urlHelper(null), "");
  assert.equal(func.urlHelper(123), "123");
  assert.equal(func.urlHelper("not a url at all /5"), "not a url at all /*");
});

test("toDate passes a Date through by reference and treats numbers as epoch ms", () => {
  const date = new Date(1700000000000);
  assert.equal(func.toDate(date), date);
  assert.equal(func.toDate(1700000000000).getTime(), 1700000000000);
  assert.equal(func.toDate("2026-11-05T01:02:03.000Z").toISOString(), "2026-11-05T01:02:03.000Z");
});

test("toDateOrNow passes a Date through and keeps epoch numbers", () => {
  const date = new Date(1700000000000);
  assert.equal(func.toDateOrNow(date), date);
  assert.equal(func.toDateOrNow(1700000000000).getTime(), 1700000000000);
});

test("toDateOrNow treats a digits-only string as an epoch timestamp, not a now fallback", () => {
  assert.equal(func.toDateOrNow("1700000000000").getTime(), 1700000000000);
});

test("toDateOrNow falls back to now for unparseable or missing values", () => {
  const before = Date.now();
  for (const value of ["not-a-date", undefined]) {
    const fallback = func.toDateOrNow(value);
    assert.ok(!Number.isNaN(fallback.getTime()), "the fallback must never be an Invalid Date");
    assert.ok(fallback.getTime() >= before, "the fallback must be the ingest time");
  }
});

test("toNumberOrUndefined coerces finite values", () => {
  assert.equal(func.toNumberOrUndefined(5), 5);
  assert.equal(func.toNumberOrUndefined(0), 0);
  assert.equal(func.toNumberOrUndefined("5.5"), 5.5);
});

test("toNumberOrUndefined returns undefined for non-finite and non-numeric values", () => {
  assert.equal(func.toNumberOrUndefined("abc"), undefined);
  assert.equal(func.toNumberOrUndefined(Number.NaN), undefined);
  assert.equal(func.toNumberOrUndefined(Infinity), undefined);
  assert.equal(func.toNumberOrUndefined(-Infinity), undefined);
  assert.equal(func.toNumberOrUndefined({}), undefined);
  assert.equal(func.toNumberOrUndefined(null), undefined);
  assert.equal(func.toNumberOrUndefined(undefined), undefined);
});

test("toStringOrUndefined passes strings through and JSON-stringifies objects", () => {
  assert.equal(func.toStringOrUndefined("x"), "x");
  assert.equal(func.toStringOrUndefined({ foo: "bar" }), JSON.stringify({ foo: "bar" }));
  assert.equal(func.toStringOrUndefined([1, 2]), "[1,2]");
});

test("toStringOrUndefined returns undefined for numbers and other non-strings", () => {
  assert.equal(func.toStringOrUndefined(5), undefined);
  assert.equal(func.toStringOrUndefined(true), undefined);
  assert.equal(func.toStringOrUndefined(null), undefined);
  assert.equal(func.toStringOrUndefined(undefined), undefined);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(func.toStringOrUndefined(circular), undefined, "an unstringifiable object must not throw");
});

test("filterKeyWord passes strings through and JSON-stringifies other values", () => {
  assert.equal(func.filterKeyWord("keyword"), "keyword");
  assert.equal(func.filterKeyWord(5), "5");
  assert.equal(func.filterKeyWord({ a: 1 }), JSON.stringify({ a: 1 }));
});

test("filterKeyWord returns an empty string when stringification fails", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(func.filterKeyWord(circular), "");
});

test("escapeRegExp escapes every regex metacharacter so the result matches literally", () => {
  const meta = ".*+?^${}()|[]\\";
  const escaped = func.escapeRegExp(meta);
  const compiled = new RegExp(escaped);
  assert.ok(compiled.test(meta), "the escaped pattern must compile and match the literal input");
});

test("escapeRegExp turns user text into a literal pattern", () => {
  const escaped = func.escapeRegExp("a.b*c");
  assert.equal(escaped, "a\\.b\\*c");
  assert.ok(new RegExp(`^${escaped}$`).test("a.b*c"));
  assert.ok(!new RegExp(`^${escaped}$`).test("axbxc"), "escaped dots must not act as wildcards");
});

test("decryptPhone decodes two-character pairs via the decryptP table", () => {
  assert.equal(func.decryptPhone("QRxacLpFOebnsMytUvik"), "0123456789");
});

test("decryptPhone passes non-strings through untouched", () => {
  assert.equal(func.decryptPhone(123), 123);
  assert.equal(func.decryptPhone(undefined), undefined);
});

test("decryptPhone drops unknown pairs and trailing odd characters", () => {
  assert.equal(func.decryptPhone("QRzz"), "0");
  assert.equal(func.decryptPhone("QRi"), "0");
});

test("setMatchTime maps beginTime and endTime onto $match.createTime", () => {
  const match: Record<string, unknown> = {};
  func.setMatchTime({ beginTime: "2026-01-01T00:00:00.000Z", endTime: "2026-01-02T00:00:00.000Z" }, match);
  const createTime = match.createTime as { $gte: Date; $lte: Date };
  assert.equal(createTime.$gte.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(createTime.$lte.toISOString(), "2026-01-02T00:00:00.000Z");
});

test("setMatchTime sets only the bounds that are present", () => {
  const beginOnly: Record<string, unknown> = {};
  func.setMatchTime({ beginTime: "2026-01-01T00:00:00.000Z" }, beginOnly);
  assert.deepEqual(Object.keys(beginOnly.createTime as object), ["$gte"]);
  const untouched: Record<string, unknown> = {};
  func.setMatchTime({}, untouched);
  assert.equal("createTime" in untouched, false, "no bounds means no createTime key at all");
});

test("getRandomIp returns one of the fixed ip addresses", () => {
  const known = new Set(["118.112.75.70", "119.57.35.106", "221.231.219.26", "140.206.142.182"]);
  for (let i = 0; i < 20; i += 1) {
    assert.ok(known.has(getRandomIp()), "the result must come from the fixed list");
  }
});

test("mapWithConcurrency processes every item", async () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  const processed: number[] = [];
  await mapWithConcurrency(items, 4, async (item) => {
    processed.push(item);
  });
  assert.deepEqual(
    [...processed].sort((a, b) => a - b),
    items,
  );
});

test("mapWithConcurrency respects the concurrency limit", async () => {
  const items = Array.from({ length: 20 }, (_, index) => index);
  let inFlight = 0;
  let maxInFlight = 0;
  await mapWithConcurrency(items, 3, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
  });
  assert.ok(maxInFlight <= 3, `in-flight work must never exceed the limit, saw ${maxInFlight}`);
  assert.ok(maxInFlight > 1, "items must actually be processed concurrently");
});

test("mapWithConcurrency propagates a worker error", async () => {
  const failure = new Error("boom");
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw failure;
    }),
    (error: unknown) => error === failure,
  );
});

test("mapWithConcurrency resolves immediately for an empty list", async () => {
  await mapWithConcurrency([], 4, async () => {
    throw new Error("the worker must never run for an empty list");
  });
});
