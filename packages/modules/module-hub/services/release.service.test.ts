import assert from "node:assert/strict";
import { test } from "node:test";

import { pickLatestReleases, ModuleHubReleaseService } from "./release.service";

/**
 * Regression guard for R23-04: the catalog must pick the newest release by
 * commit date, not by ingestion time. A webhook delivery that arrives after a
 * newer one (retry, manual replay) used to win under the previous
 * `publishedAt desc` ordering, which silently suppressed upgrade hints.
 */

function row(moduleKey: string, sourceCommit: string, committedAt: string | null, publishedAt: string) {
  return {
    moduleKey,
    sourceCommit,
    committedAt: committedAt ? new Date(committedAt) : null,
    publishedAt: new Date(publishedAt),
  };
}

test("picks the newest commit even when an older one was ingested last", () => {
  const picked = pickLatestReleases([
    row("alpha", "older", "2026-11-01T00:00:00.000Z", "2026-11-07T10:00:00.000Z"),
    row("alpha", "newer", "2026-11-05T00:00:00.000Z", "2026-11-06T10:00:00.000Z"),
  ]);

  assert.equal(picked.length, 1);
  assert.equal(picked[0].sourceCommit, "newer");
});

test("a legacy row without a commit date never shadows a dated release", () => {
  const picked = pickLatestReleases([
    row("alpha", "legacy", null, "2026-11-07T10:00:00.000Z"),
    row("alpha", "dated", "2026-11-01T00:00:00.000Z", "2026-11-02T10:00:00.000Z"),
  ]);

  assert.equal(picked[0].sourceCommit, "dated");
});

test("two undated rows fall back to ingestion time", () => {
  const picked = pickLatestReleases([
    row("alpha", "first", null, "2026-11-01T10:00:00.000Z"),
    row("alpha", "second", null, "2026-11-02T10:00:00.000Z"),
  ]);

  assert.equal(picked[0].sourceCommit, "second");
});

test("keeps one row per module and preserves module order", () => {
  const picked = pickLatestReleases([
    row("beta", "b-1", "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"),
    row("alpha", "a-1", "2026-11-02T00:00:00.000Z", "2026-11-02T00:00:00.000Z"),
  ]);

  assert.deepEqual(
    picked.map((entry) => entry.moduleKey),
    ["alpha", "beta"],
  );
});

test("identical timestamps resolve deterministically by commit sha", () => {
  const first = row("alpha", "aaa", "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  const second = row("alpha", "bbb", "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");

  assert.equal(pickLatestReleases([second, first])[0].sourceCommit, "bbb");
  assert.equal(pickLatestReleases([first, second])[0].sourceCommit, "bbb");
});

test("one failing module does not abort the catalog sync", async () => {
  const github = {
    listCommits: async () => [{ sha: "head-1" }],
    getTree: async () => ({
      truncated: false,
      entries: [
        { path: "packages/modules/alpha/newbie.module.json" },
        { path: "packages/modules/broken/newbie.module.json" },
      ],
    }),
    getCommit: async () => null,
    getFileContent: async () => null,
  };
  const service = new ModuleHubReleaseService(
    { moduleHubRelease: { findUnique: async () => null } } as any,
    { get: () => undefined } as any,
    {} as any,
    github as any,
  );
  (service as any).getLastCommitForModule = async (key: string) => {
    if (key === "broken") throw Object.assign(new Error("rate limited"), { status: 403 });
    return { sha: "alpha-1", committedAt: new Date("2026-11-01T00:00:00.000Z") };
  };
  (service as any).fetchManifestAtCommit = async () => ({ key: "alpha" });
  const ingested: string[] = [];
  (service as any).ingestRelease = async (key: string) => {
    ingested.push(key);
    return {};
  };

  const result = await service.syncCatalogFromRegistry({ actorType: "system", actorId: "test" } as any);

  assert.deepEqual(ingested, ["alpha"]);
  assert.deepEqual(result.ingested, ["alpha"]);
  assert.deepEqual(result.failed, ["broken"]);
  assert.equal(result.headCommit, "head-1");
});
