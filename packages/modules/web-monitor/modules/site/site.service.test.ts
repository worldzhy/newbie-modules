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

test("getSitesInProjects scopes the query to the given project ids", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInProjects({}, ["p1", "p2"]);
  assert.deepEqual(captured[0], { projectId: { $in: ["p1", "p2"] } });
});

test("getSitesInProjects keeps an explicit projectId filter when the caller passes one", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInProjects({ projectId: "p2" }, ["p1", "p2"]);
  assert.deepEqual(captured[0], { projectId: "p2" });
});

test("getSitesInProjects keeps the text filters alongside the scope", async () => {
  const captured: Filter[] = [];
  await newService(captured).getSitesInProjects({ systemName: "api", type: "web" }, ["p1"]);
  assert.equal(captured[0].type, "web");
  assert.ok(captured[0].systemName instanceof RegExp);
  assert.deepEqual(captured[0].projectId, { $in: ["p1"] });
});

test("getWebSiteListInProjects scopes web sites to the given project ids", async () => {
  const captured: Filter[] = [];
  await newService(captured).getWebSiteListInProjects(["p1"]);
  assert.deepEqual(captured[0], { type: "web", projectId: { $in: ["p1"] } });
});

test("an empty scope matches nothing", async () => {
  const captured: Filter[] = [];
  await newService(captured).getWebSiteListInProjects([]);
  assert.deepEqual(captured[0], { type: "web", projectId: { $in: [] } });
});
