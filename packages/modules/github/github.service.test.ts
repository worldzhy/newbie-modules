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
    (name: string, fn?: Function) =>
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
    let getCall = 0;
    const m = makeOctokitMock({
      "repos.get": async () => {
        getCall++;
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
