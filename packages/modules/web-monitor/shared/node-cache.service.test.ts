import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeCacheService } from "./node-cache.service";
import type { SystemDocument } from "../models/mongo/system.schema";

/**
 * Behavior-level tests for the in-memory site cache. The invariant that
 * matters: `updateAllSiteCache` reconciles rather than upserts — a site that
 * disappears from the source list must stop resolving from the cache so
 * deleted sites stop accepting ingest after the next refresh.
 */

function site(appKey: string, systemName = `site-${appKey}`): SystemDocument {
  return { appKey, systemName } as unknown as SystemDocument;
}

test("set and get round-trip a cached site, remove evicts it", () => {
  const cache = new NodeCacheService();
  const system = site("app1");
  cache.setAppInfo("app1", system);
  assert.equal(cache.getAppInfo("app1"), system);
  cache.removeAppInfo("app1");
  assert.equal(cache.getAppInfo("app1"), undefined);
});

test("get returns undefined for an unknown appKey", () => {
  const cache = new NodeCacheService();
  assert.equal(cache.getAppInfo("unknown"), undefined);
});

test("get and set throw on an empty appKey", () => {
  const cache = new NodeCacheService();
  assert.throws(() => cache.getAppInfo(""), /must not be empty/);
  assert.throws(() => cache.setAppInfo("", site("app1")), /must not be empty/);
});

test("updateAllSiteCache evicts cached sites that are absent from the new list", () => {
  const cache = new NodeCacheService();
  cache.setAppInfo("keep", site("keep"));
  cache.setAppInfo("stale", site("stale"));
  cache.updateAllSiteCache([site("keep")]);
  assert.ok(cache.getAppInfo("keep"), "a site present in the new list must stay cached");
  assert.equal(cache.getAppInfo("stale"), undefined, "a site absent from the new list must be evicted");
});

test("updateAllSiteCache upserts present sites and adds new ones", () => {
  const cache = new NodeCacheService();
  cache.setAppInfo("keep", site("keep", "old-name"));
  const refreshed = site("keep", "new-name");
  const added = site("added");
  cache.updateAllSiteCache([refreshed, added]);
  assert.equal(cache.getAppInfo("keep"), refreshed, "a present site must be replaced with the fresh document");
  assert.equal(cache.getAppInfo("added"), added, "a new site must become visible in the cache");
});

test("updateAllSiteCache with an empty list drains the cache", () => {
  const cache = new NodeCacheService();
  cache.setAppInfo("gone", site("gone"));
  cache.updateAllSiteCache([]);
  assert.equal(cache.getAppInfo("gone"), undefined);
});
