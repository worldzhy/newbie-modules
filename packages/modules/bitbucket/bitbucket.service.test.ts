import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BitbucketNotConfiguredError, BitbucketService } from "./bitbucket.service";

/**
 * Contract for the Bitbucket client's repository surface used by
 * security-evaluation: URL parsing, file reads, commit lookup and
 * tree walking. The read-only surface is designed to mirror
 * GitHubService so host code treats both as interchangeable for
 * CODE_SCAN snapshot wiring.
 *
 * Run: `node --import tsx --test packages/modules/bitbucket/bitbucket.service.test.ts`
 */

function makeService(env: Record<string, string | undefined>): BitbucketService {
  return new BitbucketService({
    getOrThrow: () => ({
      accessToken: env.BITBUCKET_ACCESS_TOKEN,
      apiEmail: env.BITBUCKET_API_EMAIL,
      apiToken: env.BITBUCKET_API_TOKEN,
    }),
  } as any);
}

/** Helper: expect a Bearer auth header on the first fetch call. */
function assertBearerHeader(calls: { init?: RequestInit }[], expectedToken: string) {
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${expectedToken}`);
}

/** Helper: expect a Basic auth header on the first fetch call. */
function assertBasicHeader(calls: { init?: RequestInit }[], expectedEmail: string, expectedToken: string) {
  const headers = calls[0].init?.headers as Record<string, string>;
  const expected = `Basic ${Buffer.from(`${expectedEmail}:${expectedToken}`).toString("base64")}`;
  assert.equal(headers.Authorization, expected);
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown = "") {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => raw,
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    } as any;
  }) as any;
  return calls;
}

describe("BitbucketService.parseBitbucketUrl", () => {
  const service = makeService({});

  it("parses HTTPS URLs with and without the .git suffix or trailing slash", () => {
    assert.deepEqual(service.parseBitbucketUrl("https://bitbucket.org/acme/atlas-api"), {
      workspace: "acme",
      repo: "atlas-api",
    });
    assert.deepEqual(service.parseBitbucketUrl("https://bitbucket.org/acme/atlas-api.git"), {
      workspace: "acme",
      repo: "atlas-api",
    });
    assert.deepEqual(service.parseBitbucketUrl("https://bitbucket.org/acme/atlas-api/"), {
      workspace: "acme",
      repo: "atlas-api",
    });
  });

  it("parses SSH URLs", () => {
    assert.deepEqual(service.parseBitbucketUrl("git@bitbucket.org:acme/atlas-api.git"), {
      workspace: "acme",
      repo: "atlas-api",
    });
  });

  it("returns null for non-Bitbucket hosts, deeper paths and garbage", () => {
    assert.equal(service.parseBitbucketUrl("https://github.com/acme/atlas-api"), null);
    assert.equal(service.parseBitbucketUrl("https://bitbucket.org/acme/atlas-api/src/main"), null);
    assert.equal(service.parseBitbucketUrl("not a url"), null);
    assert.equal(service.parseBitbucketUrl(""), null);
  });
});

describe("BitbucketService.getFileContent", () => {
  it("reads HEAD content by default and encodes every path segment", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, '{"lockfileVersion":3}');

    const content = await service.getFileContent("acme", "atlas-api", "packages/web app/package-lock.json");

    assert.equal(content, '{"lockfileVersion":3}');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.bitbucket.org/2.0/repositories/acme/atlas-api/src/HEAD/packages/web%20app/package-lock.json",
    );
    assertBearerHeader(calls, "token");
  });

  it("uses Basic auth when configured with personal API token + email", async () => {
    const service = makeService({
      BITBUCKET_API_EMAIL: "dev@acme.com",
      BITBUCKET_API_TOKEN: "personal-token-xyz",
    });
    const calls = stubFetch(200, "ok");
    await service.getFileContent("acme", "atlas-api", "README.md");
    assertBasicHeader(calls, "dev@acme.com", "personal-token-xyz");
  });

  it("prefers Bearer over Basic when both credential forms are present", async () => {
    const service = makeService({
      BITBUCKET_ACCESS_TOKEN: "workspace-token",
      BITBUCKET_API_EMAIL: "dev@acme.com",
      BITBUCKET_API_TOKEN: "personal-token",
    });
    const calls = stubFetch(200, "ok");
    await service.getFileContent("acme", "atlas-api", "README.md");
    assertBearerHeader(calls, "workspace-token");
  });

  it("rejects reads when neither credential form is configured", async () => {
    const service = makeService({});
    await assert.rejects(
      service.getFileContent("acme", "atlas-api", "package-lock.json"),
      (error: any) => error instanceof BitbucketNotConfiguredError,
    );
  });

  it("reads content at a specified ref (branch or sha)", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, "console.log('hi')");

    await service.getFileContent("acme", "atlas-api", "src/index.js", "main");
    assert.equal(calls[0].url, "https://api.bitbucket.org/2.0/repositories/acme/atlas-api/src/main/src/index.js");

    const sha = "abc123def456";
    await service.getFileContent("acme", "atlas-api", "src/index.js", sha);
    assert.equal(calls[1].url, `https://api.bitbucket.org/2.0/repositories/acme/atlas-api/src/${sha}/src/index.js`);
  });

  it("returns null when the file does not exist (404)", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(404, "Not found");
    assert.equal(await service.getFileContent("acme", "atlas-api", "package-lock.json"), null);
  });

  it("throws on other API failures instead of reporting no material", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(403, "Forbidden");
    await assert.rejects(service.getFileContent("acme", "atlas-api", "package-lock.json"), /Bitbucket API 403/);
  });
});

describe("BitbucketService.getCommit", () => {
  const FULL_COMMIT = {
    hash: "f7591a13eda445d9a9167f98eb870319f4b6c2d8",
    message: "Add a GEORDI_OUTPUT_DIR setting",
    date: "2012-07-16T19:37:54+00:00",
    author: {
      raw: "Brodie Rao <brodie@example.com>",
      user: { display_name: "Brodie Rao", nickname: "brodie" },
    },
  };

  it("returns the commit mapped to the platform interface shape", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, FULL_COMMIT);

    const commit = await service.getCommit("acme", "atlas-api", "HEAD");
    assert.deepEqual(commit, {
      sha: "f7591a13eda445d9a9167f98eb870319f4b6c2d8",
      message: "Add a GEORDI_OUTPUT_DIR setting",
      authorName: "Brodie Rao",
      authorEmail: "brodie@example.com",
      committedAt: new Date("2012-07-16T19:37:54+00:00"),
    });
    assert.equal(calls[0].url, "https://api.bitbucket.org/2.0/repositories/acme/atlas-api/commit/HEAD");
  });

  it("handles a string-form author without <email>", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(200, { ...FULL_COMMIT, author: "Brodie Rao" });

    const commit = await service.getCommit("acme", "atlas-api", "HEAD");
    assert.equal(commit?.authorName, "Brodie Rao");
    assert.equal(commit?.authorEmail, null);
  });

  it("returns null on 404", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(404, "Not found");
    assert.equal(await service.getCommit("acme", "atlas-api", "nonexistent"), null);
  });

  it("throws on other API errors", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(401, "Unauthorized");
    await assert.rejects(service.getCommit("acme", "atlas-api", "HEAD"), /Bitbucket API 401/);
  });

  it("rejects calls when credentials are missing", async () => {
    const service = makeService({});
    await assert.rejects(
      service.getCommit("acme", "atlas-api", "HEAD"),
      (error: any) => error instanceof BitbucketNotConfiguredError,
    );
  });
});

describe("BitbucketService.getRepository", () => {
  it("maps the repository payload to the platform shape", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, {
      full_name: "acme/atlas-api",
      is_private: true,
      mainbranch: { name: "develop" },
      links: { clone: [{ name: "https", href: "https://bitbucket.org/acme/atlas-api.git" }] },
    });

    const repository = await service.getRepository("acme", "atlas-api");
    assert.deepEqual(repository, {
      fullName: "acme/atlas-api",
      cloneUrl: "https://bitbucket.org/acme/atlas-api.git",
      defaultBranch: "develop",
      private: true,
    });
    assert.equal(calls[0].url, "https://api.bitbucket.org/2.0/repositories/acme/atlas-api");
  });

  it("falls back when optional fields are missing (empty repository)", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(200, { mainbranch: null });

    const repository = await service.getRepository("acme", "empty");
    assert.deepEqual(repository, {
      fullName: "acme/empty",
      cloneUrl: "https://bitbucket.org/acme/empty.git",
      defaultBranch: null,
      private: false,
    });
  });

  it("returns null on 404 and throws on other API errors", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(404, "Not found");
    assert.equal(await service.getRepository("acme", "missing"), null);

    stubFetch(401, "Unauthorized");
    await assert.rejects(service.getRepository("acme", "atlas-api"), /Bitbucket API 401/);
  });
});

describe("BitbucketService.getTree", () => {
  const TREE_PAGE = {
    pagelen: 100,
    page: 1,
    values: [
      { path: "src/index.ts", type: "commit_file", size: 2048, commit: { hash: "abc" } },
      { path: "src/utils", type: "commit_directory", commit: { hash: "abc" } },
    ],
    next: "https://api.bitbucket.org/2.0/repositories/acme/atlas-api/src/abc/?pagelen=100&page=2&max_depth=999",
  };

  const TREE_PAGE_2 = {
    pagelen: 100,
    page: 2,
    values: [{ path: "src/utils/helper.ts", type: "commit_file", size: 512, commit: { hash: "abc" } }],
    // no next → last page
  };

  it("fetches the recursive tree with max_depth and follows pagination", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });

    const urls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      urls.push(String(url));
      const body = urls.length === 1 ? TREE_PAGE : TREE_PAGE_2;
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as any;
    }) as any;

    const tree = await service.getTree("acme", "atlas-api", "abc123", true);

    assert.equal(tree?.truncated, false);
    assert.equal(tree?.entries.length, 3);
    assert.deepEqual(
      tree?.entries.map((e) => ({ path: e.path, type: e.type, size: e.size })),
      [
        { path: "src/index.ts", type: "blob", size: 2048 },
        { path: "src/utils", type: "tree", size: null },
        { path: "src/utils/helper.ts", type: "blob", size: 512 },
      ],
    );
    // First page has max_depth=999, second page follows the next link verbatim.
    assert.ok(urls[0].includes("max_depth=999"));
    assert.ok(urls[0].includes("pagelen=100"));
    assert.equal(urls[1], TREE_PAGE.next);
  });

  it("omits max_depth when recursive=false (root listing only)", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, {
      pagelen: 100,
      values: [{ path: "README.md", type: "commit_file", size: 100 }],
    });

    const tree = await service.getTree("acme", "atlas-api", "abc123", false);
    assert.equal(tree?.entries.length, 1);
    assert.equal(calls[0].url.includes("max_depth"), false);
  });

  it("returns null on 404", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(404, "Not found");
    assert.equal(await service.getTree("acme", "atlas-api", "unknown-ref"), null);
  });

  it("marks the tree as truncated on 555 (Bitbucket max_depth timeout)", async () => {
    const service = makeService({ BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(555, "");
    const tree = await service.getTree("acme", "atlas-api", "abc", true);
    assert.equal(tree?.truncated, true);
    assert.equal(tree?.entries.length, 0);
  });

  it("rejects calls when credentials are missing", async () => {
    const service = makeService({});
    await assert.rejects(
      service.getTree("acme", "atlas-api", "HEAD", true),
      (error: any) => error instanceof BitbucketNotConfiguredError,
    );
  });
});
