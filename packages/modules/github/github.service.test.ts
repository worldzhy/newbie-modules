import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitHubService, GitHubNotConfiguredError, RepoNameConflictError } from "./github.service";

/**
 * M8 verification: GithubAdapter with an injected mock Octokit - verifies getOrCreateRepo idempotency,
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
  "repos.listCommits": (args: any) => Promise<any>;
  "repos.getCommit": (args: any) => Promise<any>;
  "git.getTree": (args: any) => Promise<any>;
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
      listCommits: wrap("repos.listCommits", handlers["repos.listCommits"]),
      getCommit: wrap("repos.getCommit", handlers["repos.getCommit"]),
    },
    git: {
      getTree: wrap("git.getTree", handlers["git.getTree"]),
    },
  };
}

function makeService(octokit: any): GitHubService {
  const fakeConfig = {
    getOrThrow: () => ({ auth: "fake-pat" }),
  } as any;
  const service = new GitHubService(fakeConfig);
  service.octokit = octokit;
  return service;
}

/** Service constructed with neither the App triplet nor a PAT — no octokit. */
function makeUnconfiguredService(): GitHubService {
  const emptyConfig = {
    getOrThrow: () => ({}),
  } as any;
  return new GitHubService(emptyConfig);
}

function httpError(status: number, message?: string) {
  const e: any = new Error(message ?? `HTTP ${status}`);
  e.status = status;
  return e;
}

// Speed up sleeps: zero out setTimeout only inside the generate retry loop of getOrCreateRepo.
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

  it("returns false when no credentials are configured", () => {
    const service = makeUnconfiguredService();
    assert.equal(service.isConfigured(), false);
  });
});

describe("GitHubService without credentials", () => {
  it("rejects API calls with GitHubNotConfiguredError instead of a bare TypeError", async () => {
    const service = makeUnconfiguredService();
    await assert.rejects(service.deleteRepo("o", "r"), (e: any) => e instanceof GitHubNotConfiguredError);
    await assert.rejects(
      service.getOrCreateRepo("o", "n", "to", "tr"),
      (e: any) => e instanceof GitHubNotConfiguredError,
    );
    await assert.rejects(
      service.getFileContent("o", "r", "package-lock.json"),
      (e: any) => e instanceof GitHubNotConfiguredError,
    );
    await assert.rejects(service.listCommits("o", "r"), (e: any) => e instanceof GitHubNotConfiguredError);
    await assert.rejects(service.getTree("o", "r", "main"), (e: any) => e instanceof GitHubNotConfiguredError);
    await assert.rejects(service.getCommit("o", "r", "main"), (e: any) => e instanceof GitHubNotConfiguredError);
  });

  it("keeps credential-free helpers usable (buildCloneUrl, parseGitHubUrl)", () => {
    const service = makeUnconfiguredService();
    assert.equal(service.buildCloneUrl("acme", "atlas-api"), "https://github.com/acme/atlas-api.git");
    assert.deepEqual(service.parseGitHubUrl("https://github.com/acme/atlas-api"), {
      owner: "acme",
      repo: "atlas-api",
    });
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

describe("GitHubService.getRepository", () => {
  it("maps the repository payload to the platform shape", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => ({
        data: {
          full_name: "acme/atlas-api",
          clone_url: "https://github.com/acme/atlas-api.git",
          default_branch: "main",
          private: true,
        },
      }),
    });

    const repository = await makeService(m).getRepository("acme", "atlas-api");
    assert.deepEqual(repository, {
      fullName: "acme/atlas-api",
      cloneUrl: "https://github.com/acme/atlas-api.git",
      defaultBranch: "main",
      private: true,
    });
    assert.deepEqual(m.calls["repos.get"][0][0], { owner: "acme", repo: "atlas-api" });
  });

  it("returns null on 404 (missing repo or invisible to the credential)", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(404);
      },
    });
    assert.equal(await makeService(m).getRepository("acme", "atlas-api"), null);
  });

  it("rethrows non-404 errors", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(403);
      },
    });
    await assert.rejects(makeService(m).getRepository("acme", "atlas-api"), (e: any) => e.status === 403);
  });

  it("treats an empty repository (null default_branch) as readable", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => ({
        data: {
          full_name: "acme/empty",
          clone_url: "https://github.com/acme/empty.git",
          default_branch: null,
          private: true,
        },
      }),
    });
    const repository = await makeService(m).getRepository("acme", "empty");
    assert.equal(repository?.defaultBranch, null);
  });
});

describe("GitHubService.getFileContent", () => {
  const encodeFile = (text: string) => ({
    data: { type: "file", content: Buffer.from(text).toString("base64"), sha: "blob-1" },
  });

  it("reads the default branch when no ref is given (existing call shape unchanged)", async () => {
    const m = makeOctokitMock({ "repos.getContent": async () => encodeFile("hello") });
    const service = makeService(m);
    assert.equal(await service.getFileContent("o", "r", "a.txt"), "hello");
    assert.equal("ref" in m.calls["repos.getContent"][0][0], false);
  });

  it("forwards an explicit ref to the contents API", async () => {
    const m = makeOctokitMock({ "repos.getContent": async () => encodeFile("pinned") });
    const service = makeService(m);
    assert.equal(await service.getFileContent("o", "r", "a.txt", "abc123"), "pinned");
    assert.equal(m.calls["repos.getContent"][0][0].ref, "abc123");
  });

  it("returns null for a directory payload and for 404", async () => {
    const directory = makeService(
      makeOctokitMock({ "repos.getContent": async () => ({ data: [{ type: "file", path: "a.txt" }] }) }),
    );
    assert.equal(await directory.getFileContent("o", "r", "dir"), null);

    const missing = makeService(
      makeOctokitMock({
        "repos.getContent": async () => {
          throw httpError(404);
        },
      }),
    );
    assert.equal(await missing.getFileContent("o", "r", "a.txt"), null);
  });

  it("rethrows non-404 errors", async () => {
    const m = makeOctokitMock({
      "repos.getContent": async () => {
        throw httpError(403);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.getFileContent("o", "r", "a.txt"), (e: any) => e.status === 403);
  });
});

describe("GitHubService.listCommits", () => {
  function commitPayload(sha: string): any {
    return {
      sha,
      commit: {
        message: `message ${sha}`,
        author: { name: "Ada", email: "ada@example.com", date: "2026-11-01T00:00:00Z" },
        committer: { date: "2026-11-02T00:00:00Z" },
      },
    };
  }

  it("maps commit metadata and forwards path/perPage", async () => {
    const m = makeOctokitMock({ "repos.listCommits": async () => ({ data: [commitPayload("sha-1")] }) });
    const service = makeService(m);

    const commits = await service.listCommits("o", "r", { path: "packages/modules/alpha", perPage: 1 });

    assert.deepEqual(commits, [
      {
        sha: "sha-1",
        message: "message sha-1",
        authorName: "Ada",
        authorEmail: "ada@example.com",
        committedAt: new Date("2026-11-02T00:00:00Z"),
      },
    ]);
    const arg = m.calls["repos.listCommits"][0][0];
    assert.equal(arg.path, "packages/modules/alpha");
    assert.equal(arg.per_page, 1);
  });

  it("omits optional parameters and falls back to the author date", async () => {
    const payload = commitPayload("sha-2");
    payload.commit.committer = null;
    const m = makeOctokitMock({ "repos.listCommits": async () => ({ data: [payload] }) });
    const service = makeService(m);

    const commits = await service.listCommits("o", "r");

    assert.equal(commits[0].committedAt?.toISOString(), "2026-11-01T00:00:00.000Z");
    const arg = m.calls["repos.listCommits"][0][0];
    assert.equal("path" in arg, false);
    assert.equal("per_page" in arg, false);
  });

  it("returns an empty list on 404 and rethrows other errors", async () => {
    const notFound = makeService(
      makeOctokitMock({
        "repos.listCommits": async () => {
          throw httpError(404);
        },
      }),
    );
    assert.deepEqual(await notFound.listCommits("o", "r"), []);

    const forbidden = makeService(
      makeOctokitMock({
        "repos.listCommits": async () => {
          throw httpError(403);
        },
      }),
    );
    await assert.rejects(forbidden.listCommits("o", "r"), (e: any) => e.status === 403);
  });
});

describe("GitHubService.getTree", () => {
  it("maps entries, reports truncation and forwards recursive", async () => {
    const m = makeOctokitMock({
      "git.getTree": async () => ({
        data: {
          truncated: true,
          tree: [
            { path: "packages/modules/alpha/newbie.module.json", type: "blob", sha: "b-1", size: 42 },
            { path: "packages/modules/alpha", type: "tree", sha: "t-1" },
          ],
        },
      }),
    });
    const service = makeService(m);

    const tree = await service.getTree("o", "r", "head-1", true);

    assert.deepEqual(tree, {
      truncated: true,
      entries: [
        { path: "packages/modules/alpha/newbie.module.json", type: "blob", sha: "b-1", size: 42 },
        { path: "packages/modules/alpha", type: "tree", sha: "t-1", size: null },
      ],
    });
    assert.equal(m.calls["git.getTree"][0][0].recursive, "true");
    assert.equal(m.calls["git.getTree"][0][0].tree_sha, "head-1");
  });

  it("omits recursive by default and returns null on 404", async () => {
    const m = makeOctokitMock({
      "git.getTree": async () => ({ data: { truncated: false, tree: [] } }),
    });
    const service = makeService(m);
    assert.deepEqual(await service.getTree("o", "r", "main"), { truncated: false, entries: [] });
    assert.equal("recursive" in m.calls["git.getTree"][0][0], false);

    const missing = makeService(
      makeOctokitMock({
        "git.getTree": async () => {
          throw httpError(404);
        },
      }),
    );
    assert.equal(await missing.getTree("o", "r", "nope"), null);
  });

  it("rethrows non-404 errors", async () => {
    const m = makeOctokitMock({
      "git.getTree": async () => {
        throw httpError(500);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.getTree("o", "r", "main"), (e: any) => e.status === 500);
  });
});

describe("GitHubService.getCommit", () => {
  it("maps one commit's metadata", async () => {
    const m = makeOctokitMock({
      "repos.getCommit": async () => ({
        data: {
          sha: "sha-9",
          commit: {
            message: "fix: something",
            author: { name: "Ada", email: "ada@example.com", date: "2026-11-01T00:00:00Z" },
            committer: { date: "2026-11-03T00:00:00Z" },
          },
        },
      }),
    });
    const service = makeService(m);

    const commit = await service.getCommit("o", "r", "sha-9");

    assert.deepEqual(commit, {
      sha: "sha-9",
      message: "fix: something",
      authorName: "Ada",
      authorEmail: "ada@example.com",
      committedAt: new Date("2026-11-03T00:00:00Z"),
    });
    assert.equal(m.calls["repos.getCommit"][0][0].ref, "sha-9");
  });

  it("returns null on 404 and rethrows other errors", async () => {
    const notFound = makeService(
      makeOctokitMock({
        "repos.getCommit": async () => {
          throw httpError(404);
        },
      }),
    );
    assert.equal(await notFound.getCommit("o", "r", "nope"), null);

    const forbidden = makeService(
      makeOctokitMock({
        "repos.getCommit": async () => {
          throw httpError(403);
        },
      }),
    );
    await assert.rejects(forbidden.getCommit("o", "r", "main"), (e: any) => e.status === 403);
  });
});

describe("GitHubService.getOrCreateRepo", () => {
  it("returns existing clone_url without calling generate when repo already exists (idempotent)", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => ({ data: { clone_url: "https://existing.example/x.git" } }),
    });
    const service = makeService(m);
    const r = await service.getOrCreateRepo("o", "n", "to", "tr");
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
    const r = await withNoSleep(() => service.getOrCreateRepo("o", "n", "to", "tr"));
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
    await assert.rejects(service.getOrCreateRepo("o", "n", "to", "tr"), (e: any) => e instanceof RepoNameConflictError);
  });

  it("rethrows non-404 errors from initial GET", async () => {
    const m = makeOctokitMock({
      "repos.get": async () => {
        throw httpError(500);
      },
    });
    const service = makeService(m);
    await assert.rejects(service.getOrCreateRepo("o", "n", "to", "tr"), (e: any) => e.status === 500);
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
    await assert.rejects(service.getOrCreateRepo("o", "n", "to", "tr"), (e: any) => e.status === 403);
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
    const r = await withNoSleep(() => service.getOrCreateRepo("o", "n", "to", "tr"));
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
