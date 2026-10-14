import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitHubService, RepoNameConflictError } from "./github.service";

/**
 * M8 verification: GithubAdapter with an injected mock Octokit - verifies ensureRepoExists idempotency,
 * upsertEnvExample merges without overwriting, deleteRepo is best-effort.
 *
 * Run: `npm test` in the container, or `node --import tsx --test src/modules/github/github.service.test.ts`
 */

// --- helpers ---

type OctokitMethods = {
  "repos.get": (args: any) => Promise<any>;
  "repos.createUsingTemplate": (args: any) => Promise<any>;
  "repos.getContent": (args: any) => Promise<any>;
  "repos.createOrUpdateFileContents": (args: any) => Promise<any>;
  "repos.delete": (args: any) => Promise<any>;
};

function makeOctokitMock(handlers: Partial<OctokitMethods>) {
  const calls: Record<string, any[]> = {};
  const wrap =
    (name: string, fn?: (...args: any[]) => any) =>
    (...args: any[]) => {
      (calls[name] ??= []).push(args);
      return fn ? fn(...args) : Promise.resolve();
    };
  return {
    calls,
    repos: {
      get: wrap("repos.get", handlers["repos.get"]),
      createUsingTemplate: wrap("repos.createUsingTemplate", handlers["repos.createUsingTemplate"]),
      getContent: wrap("repos.getContent", handlers["repos.getContent"]),
      createOrUpdateFileContents: wrap(
        "repos.createOrUpdateFileContents",
        handlers["repos.createOrUpdateFileContents"],
      ),
      delete: wrap("repos.delete", handlers["repos.delete"]),
    },
  };
}

function makeService(octokit: any): GitHubService {
  const fakeConfig = {
    getOrThrow: () => ({ auth: "fake-pat", userAgent: "test" }),
  } as any;
  const service = new GitHubService(fakeConfig);
  service.octokit = octokit;
  return service;
}

function httpError(status: number, message?: string) {
  const e: any = new Error(message ?? `HTTP ${status}`);
  e.status = status;
  return e;
}

// Speed up sleeps: zero out setTimeout only inside the generate retry loop of ensureRepoExists.
// A global replacement has side effects, so use an isolated approach here: skip the service's internal sleep directly
// Applied via monkey-patching global.setTimeout only within the it blocks that need speeding up.
function withNoSleep<T>(fn: () => Promise<T>): Promise<T> {
  const original = global.setTimeout;
  // Replace with a synchronous version that fires immediately (keeping the timer id shape).
  (global as any).setTimeout = ((fn: any) => {
    fn();
    return 0 as any;
  }) as any;
  return fn().finally(() => {
    (global as any).setTimeout = original;
  });
}

// --- tests ---

describe("GitHubService.isConfigured", () => {
  it("returns true in PAT mode", () => {
    const service = makeService(makeOctokitMock({}));
    assert.equal(service.isConfigured(), true);
  });
});

describe("GitHubService.buildCloneUrl", () => {
  it("builds the canonical HTTPS clone URL matching GitHub clone_url shape", () => {
    const service = makeService(makeOctokitMock({}));
    assert.equal(service.buildCloneUrl("acme", "atlas-api"), "https://github.com/acme/atlas-api.git");
  });
});

describe("GitHubService.parseGitHubUrl", () => {
  const service = makeService(makeOctokitMock({}));

  it("parses HTTPS URLs without suffix", () => {
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas-api"), {
      owner: "acme",
      repo: "atlas-api",
    });
  });

  it("parses HTTPS URLs with .git suffix and/or trailing slash", () => {
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas-api.git"), {
      owner: "acme",
      repo: "atlas-api",
    });
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas-api/"), {
      owner: "acme",
      repo: "atlas-api",
    });
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas-api.git/"), {
      owner: "acme",
      repo: "atlas-api",
    });
  });

  it("parses SSH URLs", () => {
    assert.deepEqual(service.parseGitHubUrl("git@github.com:acme/atlas-api.git"), {
      owner: "acme",
      repo: "atlas-api",
    });
    assert.deepEqual(service.parseGitHubUrl("git@github.com:acme/atlas-api"), {
      owner: "acme",
      repo: "atlas-api",
    });
  });

  it("preserves dots inside repo names", () => {
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas.api"), {
      owner: "acme",
      repo: "atlas.api",
    });
  });

  it("returns null for non-GitHub hosts, deeper paths and garbage", () => {
    assert.equal(service.parseGitHubUrl("https://gitlab.com/acme/atlas-api"), null);
    assert.equal(service.parseGitHubUrl("https://github.com/acme/atlas-api/tree/main"), null);
    assert.equal(service.parseGitHubUrl("not a url"), null);
    assert.equal(service.parseGitHubUrl(""), null);
  });
});

describe("GitHubService.ensureRepoExists", () => {
  it("returns existing clone_url without calling generate when repo already exists (idempotent)", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => ({ data: { clone_url: "https://existing.example/x.git" } }),
    });
    const service = makeService(m);
    const r = await service.ensureRepoExists("o", "n", "to", "tr");
    assert.equal(r.generated, false);
    assert.equal(r.cloneUrl, "https://existing.example/x.git");
    assert.equal(m.calls["repos.createUsingTemplate"]?.length ?? 0, 0);
  });

  it("generates from template when 404 and waits for repo to become readable", async () => {
    let getCall = 0;
    const m = makeOctokitMock({
      "repos.get": async () => {
        getCall++;
        if (getCall === 1) throw httpError(404); // initial: does not exist
        return { data: { clone_url: "https://gen.example/x.git" } }; // post-generate: readable
      },
      "repos.createUsingTemplate": async () => ({
        data: { clone_url: "https://gen.example/x.git" },
      }),
    });
    const service = makeService(m);
    const r = await withNoSleep(() => service.ensureRepoExists("o", "n", "to", "tr"));
    assert.equal(r.generated, true);
    assert.equal(r.cloneUrl, "https://gen.example/x.git");
    assert.equal(m.calls["repos.createUsingTemplate"].length, 1);
  });

  it("throws RepoNameConflictError when generate returns 422 (name taken by unowned repo)", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(404);
      },
      "repos.createUsingTemplate": async () => {
        throw httpError(422);
      },
    });
    const service = makeService(m);
    await assert.rejects(
      service.ensureRepoExists("o", "n", "to", "tr"),
      (e: any) => e instanceof RepoNameConflictError,
    );
  });

  it("rethrows non-404 errors from initial GET", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(500);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.ensureRepoExists("o", "n", "to", "tr"), (e: any) => e.status === 500);
  });

  it("rethrows non-422 errors from generate", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(404);
      },
      "repos.createUsingTemplate": async () => {
        throw httpError(403);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.ensureRepoExists("o", "n", "to", "tr"), (e: any) => e.status === 403);
  });

  it("warns and continues when repo not readable after 3 retries", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        // first call: initial 404, then 3 retries all 404
        throw httpError(404);
      },
      "repos.createUsingTemplate": async () => ({
        data: { clone_url: "https://gen.example/x.git" },
      }),
    });
    const service = makeService(m);
    const r = await withNoSleep(() => service.ensureRepoExists("o", "n", "to", "tr"));
    assert.equal(r.generated, true);
    assert.equal(r.cloneUrl, "https://gen.example/x.git");
    // initial GET + 3 retries = 4 GET calls; generate called once.
    assert.equal(m.calls["repos.get"].length, 4);
    assert.equal(m.calls["repos.createUsingTemplate"].length, 1);
  });
});

describe("GitHubService.upsertEnvExample", () => {
  it("no-op when placeholderLines is empty", async () => {
    const m = makeOctokitMock({});
    const service = makeService(m);
    await service.upsertEnvExample("o", "r", []);
    assert.equal(m.calls["repos.getContent"]?.length ?? 0, 0);
    assert.equal(m.calls["repos.createOrUpdateFileContents"]?.length ?? 0, 0);
  });

  it("creates new file when 404 (no sha)", async () => {
    const m = makeOctokitMock({
      "repos.getContent": async () => {
        throw httpError(404);
      },
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    await service.upsertEnvExample("o", "r", ["# FOO=", "# BAR="]);
    assert.equal(m.calls["repos.createOrUpdateFileContents"].length, 1);
    const arg = m.calls["repos.createOrUpdateFileContents"][0][0];
    assert.equal(arg.sha, undefined);
    const decoded = Buffer.from(arg.content, "base64").toString("utf-8");
    assert.equal(decoded, "# FOO=\n# BAR=\n");
  });

  it("appends only missing keys — never overwrites existing template content (merge semantics)", async () => {
    const existing = "# FOO=old\n# BAZ=keep\n";
    const m = makeOctokitMock({
      "repos.getContent": async () => ({
        data: {
          type: "file",
          content: Buffer.from(existing).toString("base64"),
          sha: "abc",
        },
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    // FOO present in file (skip), BAR new (append). # FOO=newvalue must not overwrite # FOO=old.
    await service.upsertEnvExample("o", "r", ["# FOO=newvalue", "# BAR=new"]);
    assert.equal(m.calls["repos.createOrUpdateFileContents"].length, 1);
    const arg = m.calls["repos.createOrUpdateFileContents"][0][0];
    assert.equal(arg.sha, "abc");
    const decoded = Buffer.from(arg.content, "base64").toString("utf-8");
    assert.equal(decoded, "# FOO=old\n# BAZ=keep\n# BAR=new\n");
  });

  it("skips write when all keys already present (idempotent retry)", async () => {
    const existing = "# FOO=\n# BAR=\n";
    const m = makeOctokitMock({
      "repos.getContent": async () => ({
        data: {
          type: "file",
          content: Buffer.from(existing).toString("base64"),
          sha: "abc",
        },
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    await service.upsertEnvExample("o", "r", ["# FOO=", "# BAR="]);
    assert.equal(m.calls["repos.createOrUpdateFileContents"]?.length ?? 0, 0);
  });

  it("handles existing file without trailing newline", async () => {
    const existing = "# FOO=old";
    const m = makeOctokitMock({
      "repos.getContent": async () => ({
        data: {
          type: "file",
          content: Buffer.from(existing).toString("base64"),
          sha: "abc",
        },
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    await service.upsertEnvExample("o", "r", ["# BAR=new"]);
    const arg = m.calls["repos.createOrUpdateFileContents"][0][0];
    const decoded = Buffer.from(arg.content, "base64").toString("utf-8");
    assert.equal(decoded, "# FOO=old\n# BAR=new\n");
  });

  it("rethrows non-404 errors from getContent", async () => {
    const m = makeOctokitMock({
      "repos.getContent": async () => {
        throw httpError(403);
      },
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    await assert.rejects(service.upsertEnvExample("o", "r", ["# FOO="]), (e: any) => e.status === 403);
  });

  it("detects keys with leading spaces and no leading # (permissive parsing)", async () => {
    const existing = "FOO=realvalue\n";
    const m = makeOctokitMock({
      "repos.getContent": async () => ({
        data: {
          type: "file",
          content: Buffer.from(existing).toString("base64"),
          sha: "abc",
        },
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);
    // FOO detected as existing key (no leading #), so # FOO= placeholder is skipped.
    await service.upsertEnvExample("o", "r", ["  # FOO=...", "# BAR="]);
    const arg = m.calls["repos.createOrUpdateFileContents"][0][0];
    const decoded = Buffer.from(arg.content, "base64").toString("utf-8");
    assert.equal(decoded, "FOO=realvalue\n# BAR=\n");
  });
});

describe("GitHubService.rewritePackageIdentity", () => {
  const encodeFile = (text: string, sha = "sha-1") => ({
    data: { type: "file", content: Buffer.from(text).toString("base64"), sha },
  });

  /** Dispatch getContent by path so package.json and lockfile return distinct files. */
  function contentByPath(files: Record<string, unknown>) {
    return async (args: any) => {
      const hit = files[args.path];
      if (hit === undefined) throw httpError(404);
      return hit;
    };
  }

  it("rewrites package.json plus both lockfile root name fields in two commits", async () => {
    const packageJson = { name: "newbie-basic-template", version: "0.1.0" };
    const lock = {
      name: "newbie-basic-template",
      lockfileVersion: 3,
      packages: { "": { name: "newbie-basic-template", version: "0.1.0" } },
    };
    const m = makeOctokitMock({
      "repos.getContent": contentByPath({
        "package.json": encodeFile(JSON.stringify(packageJson, null, 2)),
        "package-lock.json": encodeFile(JSON.stringify(lock, null, 2), "sha-lock"),
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);

    await service.rewritePackageIdentity("o", "r", "my-app");

    const writes = m.calls["repos.createOrUpdateFileContents"];
    assert.equal(writes.length, 2);
    const [pkgArg, lockArg] = writes.map((w) => w[0]);
    assert.equal(pkgArg.path, "package.json");
    assert.equal(pkgArg.sha, "sha-1");
    assert.equal(JSON.parse(Buffer.from(pkgArg.content, "base64").toString("utf-8")).name, "my-app");
    assert.equal(lockArg.path, "package-lock.json");
    assert.equal(lockArg.sha, "sha-lock");
    const writtenLock = JSON.parse(Buffer.from(lockArg.content, "base64").toString("utf-8"));
    assert.equal(writtenLock.name, "my-app");
    assert.equal(writtenLock.packages[""].name, "my-app");
  });

  it("makes no commits when both files already carry the target name (idempotent retry)", async () => {
    const m = makeOctokitMock({
      "repos.getContent": contentByPath({
        "package.json": encodeFile(JSON.stringify({ name: "my-app" })),
        "package-lock.json": encodeFile(JSON.stringify({ name: "my-app", packages: { "": { name: "my-app" } } })),
      }),
    });
    const service = makeService(m);

    await service.rewritePackageIdentity("o", "r", "my-app");
    assert.equal(m.calls["repos.createOrUpdateFileContents"]?.length ?? 0, 0);
  });

  it("throws when package.json is missing (broken starter) instead of silently skipping", async () => {
    const m = makeOctokitMock({
      "repos.getContent": async () => {
        throw httpError(404);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.rewritePackageIdentity("o", "r", "my-app"), /package\.json not found/);
    assert.equal(m.calls["repos.createOrUpdateFileContents"]?.length ?? 0, 0);
  });

  it("tolerates a missing package-lock.json and only rewrites package.json", async () => {
    const m = makeOctokitMock({
      "repos.getContent": contentByPath({
        "package.json": encodeFile(JSON.stringify({ name: "fewbie-basic-template" })),
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);

    await service.rewritePackageIdentity("o", "r", "web-app");
    const writes = m.calls["repos.createOrUpdateFileContents"];
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].path, "package.json");
  });

  it("updates only the lock fields that are present", async () => {
    // Old lockfile shape without packages[""].name.
    const m = makeOctokitMock({
      "repos.getContent": contentByPath({
        "package.json": encodeFile(JSON.stringify({ name: "tpl" })),
        "package-lock.json": encodeFile(JSON.stringify({ name: "tpl", lockfileVersion: 2 }), "l"),
      }),
      "repos.createOrUpdateFileContents": async () => ({}),
    });
    const service = makeService(m);

    await service.rewritePackageIdentity("o", "r", "svc");
    const lockArg = m.calls["repos.createOrUpdateFileContents"][1][0];
    const writtenLock = JSON.parse(Buffer.from(lockArg.content, "base64").toString("utf-8"));
    assert.equal(writtenLock.name, "svc");
    assert.equal(writtenLock.packages, undefined);
  });

  it("rejects an invalid npm package name before touching the API", async () => {
    const m = makeOctokitMock({});
    const service = makeService(m);
    await assert.rejects(service.rewritePackageIdentity("o", "r", "UPPER-CASE"), /Invalid npm package name/);
    assert.equal(m.calls["repos.getContent"]?.length ?? 0, 0);
  });
});

describe("GitHubService.deleteRepo", () => {
  it("ignores 404 (best-effort deletion)", async () => {
    const m = makeOctokitMock({
      "repos.delete": async () => {
        throw httpError(404);
      },
    });
    const service = makeService(m);
    await service.deleteRepo("o", "r"); // should not throw
  });

  it("rethrows non-404 errors", async () => {
    const m = makeOctokitMock({
      "repos.delete": async () => {
        throw httpError(403);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.deleteRepo("o", "r"), (e: any) => e.status === 403);
  });

  it("succeeds on 204", async () => {
    const m = makeOctokitMock({
      "repos.delete": async () => ({ status: 204, data: undefined }),
    });
    const service = makeService(m);
    await service.deleteRepo("o", "r"); // should not throw
    assert.equal(m.calls["repos.delete"].length, 1);
  });
});
