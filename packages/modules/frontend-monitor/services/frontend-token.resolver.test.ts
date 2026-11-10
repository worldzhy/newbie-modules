import assert from "node:assert/strict";
import { test } from "node:test";

import { UnauthorizedException } from "@nestjs/common";

import { FrontendTokenResolver } from "./frontend-token.resolver";

/**
 * The resolver adapts FrontendInstallationService to security's InstallationResolver
 * port (ADR-016/ADR-019). Token verification itself lives in the shared
 * security verifier and is covered by the web-installation tests, so this
 * suite only pins the port contract, the null-to-401 mapping and the
 * throttled liveness-touch delegation.
 */

interface FakeInstallationsOptions {
  resolved?: { id: string; appKey: string } | null;
  touchError?: Error;
}

function newResolver(options: FakeInstallationsOptions = {}) {
  const calls: { resolveTokens: string[]; touchedIds: string[] } = { resolveTokens: [], touchedIds: [] };
  const installations = {
    async resolveByToken(token: string) {
      calls.resolveTokens.push(token);
      return options.resolved ?? null;
    },
    async touchOnReport(id: string) {
      calls.touchedIds.push(id);
      if (options.touchError) throw options.touchError;
    },
  };
  const resolver = new FrontendTokenResolver(installations as never);
  return { resolver, calls };
}

test("the port contract binds kind frontend-monitor and the body token field", () => {
  const { resolver } = newResolver();
  assert.equal(resolver.kind, "frontend-monitor");
  assert.equal(resolver.bodyTokenField, "token");
});

test("resolve returns installationId and appKey for a valid token", async () => {
  const { resolver, calls } = newResolver({ resolved: { id: "inst-1", appKey: "abc1234" } });
  const resolved = await resolver.resolve("plain-token");
  assert.deepEqual(resolved, { installationId: "inst-1", appKey: "abc1234" });
  assert.deepEqual(calls.resolveTokens, ["plain-token"], "the token must reach the verifier verbatim");
});

test("resolve throws UnauthorizedException when the token resolves to null", async () => {
  const { resolver } = newResolver({ resolved: null });
  await assert.rejects(resolver.resolve("unknown-token"), UnauthorizedException);
});

test("touchOnReport delegates the first report to the installation service", async () => {
  const { resolver, calls } = newResolver();
  await resolver.touchOnReport("inst-1");
  assert.deepEqual(calls.touchedIds, ["inst-1"]);
});

test("touchOnReport throttles a second report inside the throttle interval", async () => {
  const { resolver, calls } = newResolver();
  await resolver.touchOnReport("inst-1");
  await resolver.touchOnReport("inst-1");
  assert.deepEqual(calls.touchedIds, ["inst-1"], "at most one liveness write per throttle interval");
});

test("touchOnReport throttles installations independently", async () => {
  const { resolver, calls } = newResolver();
  await resolver.touchOnReport("inst-1");
  await resolver.touchOnReport("inst-2");
  assert.deepEqual(calls.touchedIds, ["inst-1", "inst-2"]);
});

test("touchOnReport retries the write when the previous attempt failed", async () => {
  const { resolver, calls } = newResolver({ touchError: new Error("database gone") });
  await assert.rejects(resolver.touchOnReport("inst-1"));
  await assert.rejects(resolver.touchOnReport("inst-1"));
  assert.equal(calls.touchedIds.length, 2, "a failed touch leaves no throttle timestamp behind");
});
