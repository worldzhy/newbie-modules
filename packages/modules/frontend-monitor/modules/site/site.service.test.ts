import assert from "node:assert/strict";
import test from "node:test";
import { SiteService } from "./site.service";

type Filter = Record<string, unknown>;

function newService(captured: Filter[]): SiteService {
  const models = {
    System: () => ({
      find: (filter: Filter) => ({
        exec: async () => {
          captured.push(filter);
          return [];
        },
      }),
    }),
  };
  return new SiteService(models as never, {} as never);
}

test("getSitesInAppKeys scopes the query to the given appKeys", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInAppKeys({}, ["abc1234", "def5678"]);
  assert.deepEqual(captured[0], { appKey: { $in: ["abc1234", "def5678"] } });
});

test("getSitesInAppKeys keeps an explicit appKey filter when the caller passes one", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInAppKeys({ appKey: "def5678" }, ["abc1234", "def5678"]);
  assert.deepEqual(captured[0], { appKey: "def5678" });
});

test("getSitesInAppKeys keeps the text filters alongside the scope", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInAppKeys({ systemName: "api", type: "web" }, ["abc1234"]);
  assert.equal(captured[0].type, "web");
  assert.ok(captured[0].systemName instanceof RegExp);
  assert.deepEqual(captured[0].appKey, { $in: ["abc1234"] });
});

test("getWebSiteListInAppKeys scopes web sites to the given appKeys", async () => {
  const captured: Filter[] = [];
  await newService(captured).getWebSiteListInAppKeys(["abc1234"]);
  assert.deepEqual(captured[0], { type: "web", appKey: { $in: ["abc1234"] } });
});

test("an empty scope matches nothing", async () => {
  const captured: Filter[] = [];
  await newService(captured).getWebSiteListInAppKeys([]);
  assert.deepEqual(captured[0], { type: "web", appKey: { $in: [] } });
});
