import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { SiteController } from "./site.controller";
import { WebMonitorAccessService } from "../web/web-monitor-access.service";

/**
 * SiteController behavior beyond thin delegation: the appKey is resolved via
 * pickRequestId precedence (params -> query -> body) and gated against the
 * caller's visible scope through the real WebMonitorAccessService (a pure
 * function of scope + request), userToken is required on the member
 * endpoints, and service results pass through func.result unwrapped.
 */

type Row = Record<string, unknown>;

function harness(options: { scope?: string[] } = {}) {
  const scope = options.scope ?? ["APP1", "APP2"];
  const visibilityCalls: string[] = [];
  const projectVisibility = {
    visibleAppKeys: async (userId: string) => {
      visibilityCalls.push(userId);
      return scope;
    },
  };
  const siteCalls: Array<{ method: string; args: unknown[] }> = [];
  const sentinel = { ok: true };
  const record =
    (method: string, result: unknown = sentinel) =>
    async (...args: unknown[]) => {
      siteCalls.push({ method, args });
      return result;
    };
  const site = {
    updateSiteData: record("updateSiteData"),
    getSitesInAppKeys: record("getSitesInAppKeys", ["row"]),
    getSiteForDb: record("getSiteForDb", { appKey: "APP1" }),
    getWebSiteListInAppKeys: record("getWebSiteListInAppKeys", ["row"]),
    deleteWebSiteUser: record("deleteWebSiteUser"),
    addWebSiteUser: record("addWebSiteUser"),
    deleteSite: record("deleteSite"),
  };
  // The access service is pure (scope + request in, decision out), so the
  // real one pins the 400/403 integration instead of a fake's promises.
  const controller = new SiteController(site as never, new WebMonitorAccessService(), projectVisibility as never);
  return { controller, siteCalls, visibilityCalls };
}

function req(parts: { params?: Row; query?: Row; body?: Row } = {}) {
  return { user: { userId: "u1" }, params: parts.params ?? {}, query: parts.query ?? {}, body: parts.body ?? {} };
}

test("updateSite resolves the appKey with params -> query -> body precedence", async () => {
  const h = harness();
  await h.controller.updateSite(
    { systemName: "x" },
    req({ params: { appKey: "APP1" }, query: { appKey: "APP2" }, body: { appKey: "APP2" } }) as never,
  );
  assert.equal(h.siteCalls[0].method, "updateSiteData");
  assert.equal(h.siteCalls[0].args[0], "APP1", "params win over query and body");
  assert.deepEqual(h.visibilityCalls, ["u1"]);
});

test("updateSite rejects a missing appKey and an out-of-scope appKey without calling the service", async () => {
  const h = harness();
  await assert.rejects(
    () => h.controller.updateSite({}, req() as never),
    (error) => error instanceof BadRequestException && error.message === "appKey is required",
  );
  await assert.rejects(
    () => h.controller.updateSite({}, req({ query: { appKey: "APP9" } }) as never),
    (error) => error instanceof ForbiddenException,
  );
  await assert.rejects(
    () => h.controller.updateSite({}, req({ query: { appKey: "not a key!" } }) as never),
    (error) => error instanceof BadRequestException,
    "a malformed appKey is a 400 shape error",
  );
  assert.equal(h.siteCalls.length, 0);
});

test("getSites asserts an explicit appKey but tolerates an absent one", async () => {
  const h = harness();
  await assert.rejects(
    () => h.controller.getSites({}, req({ query: { appKey: "APP9" } }) as never),
    (error) => error instanceof ForbiddenException,
  );
  assert.equal(h.siteCalls.length, 0, "a rejected filter never reaches the service");
  const result = await h.controller.getSites({ systemName: "api" }, req({ query: { systemName: "api" } }) as never);
  assert.deepEqual(result, ["row"], "func.result passes the service data through");
  assert.deepEqual(h.siteCalls[0].args, [{ systemName: "api" }, ["APP1", "APP2"]]);
});

test("getSiteForId delegates with the scoped appKey", async () => {
  const h = harness();
  const result = await h.controller.getSiteForId({}, req({ query: { appKey: "APP2" } }) as never);
  assert.deepEqual(result, { appKey: "APP1" });
  assert.deepEqual(h.siteCalls[0].args, ["APP2"]);
});

test("getWebSiteList lists inside the caller's scope", async () => {
  const h = harness({ scope: ["APP2"] });
  const result = await h.controller.getWebSiteList(req() as never);
  assert.deepEqual(result, ["row"]);
  assert.deepEqual(h.siteCalls[0].args, [["APP2"]]);
});

test("the member endpoints require a userToken", async () => {
  const h = harness();
  await assert.rejects(
    () => h.controller.addWebSiteUser({}, req({ query: { appKey: "APP1" } }) as never),
    (error) => error instanceof BadRequestException && /userToken is required/.test(error.message),
  );
  await assert.rejects(
    () => h.controller.deleteWebSiteUser({}, req({ query: { appKey: "APP1" } }) as never),
    (error) => error instanceof BadRequestException && /userToken is required/.test(error.message),
  );
  assert.equal(h.siteCalls.length, 0);
  assert.equal(h.visibilityCalls.length, 0, "the validation runs before any scope resolution");
});

test("addWebSiteUser and deleteWebSiteUser delegate with the scoped appKey and the token", async () => {
  const h = harness();
  await h.controller.addWebSiteUser({ userToken: "tok-1" }, req({ query: { appKey: "APP1" } }) as never);
  await h.controller.deleteWebSiteUser({ userToken: "tok-2" }, req({ query: { appKey: "APP2" } }) as never);
  assert.deepEqual(h.siteCalls[0], { method: "addWebSiteUser", args: ["APP1", "tok-1"] });
  assert.deepEqual(h.siteCalls[1], { method: "deleteWebSiteUser", args: ["APP2", "tok-2"] });
});

test("deleteSite delegates with the appKey and the type as a string", async () => {
  const h = harness();
  await h.controller.deleteSite({ type: "web" }, req({ query: { appKey: "APP1" } }) as never);
  assert.deepEqual(h.siteCalls[0], { method: "deleteSite", args: ["APP1", "web"] });
});
