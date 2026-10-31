import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BitbucketNotConfiguredError, BitbucketService } from "./bitbucket.service";

/**
 * Contract for the Bitbucket client's repository surface used by
 * security-evaluation: URL parsing (host classification) and file reads.
 *
 * Run: `node --import tsx --test packages/modules/bitbucket/bitbucket.service.test.ts`
 */

function makeService(env: Record<string, string | undefined>): BitbucketService {
  return new BitbucketService({
    getOrThrow: () => ({
      workspace: env.BITBUCKET_WORKSPACE,
      accessToken: env.BITBUCKET_ACCESS_TOKEN,
      clientId: env.BITBUCKET_CLIENT_ID,
      clientSecret: env.BITBUCKET_CLIENT_SECRET,
    }),
  } as any);
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body = "") {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => body,
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
  it("reads HEAD content and encodes every path segment", async () => {
    const service = makeService({ BITBUCKET_WORKSPACE: "acme", BITBUCKET_ACCESS_TOKEN: "token" });
    const calls = stubFetch(200, '{"lockfileVersion":3}');

    const content = await service.getFileContent("acme", "atlas-api", "packages/web app/package-lock.json");

    assert.equal(content, '{"lockfileVersion":3}');
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.bitbucket.org/2.0/repositories/acme/atlas-api/src/HEAD/packages/web%20app/package-lock.json",
    );
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer token");
  });

  it("returns null when the file does not exist (404)", async () => {
    const service = makeService({ BITBUCKET_WORKSPACE: "acme", BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(404, "Not found");
    assert.equal(await service.getFileContent("acme", "atlas-api", "package-lock.json"), null);
  });

  it("throws on other API failures instead of reporting no material", async () => {
    const service = makeService({ BITBUCKET_WORKSPACE: "acme", BITBUCKET_ACCESS_TOKEN: "token" });
    stubFetch(403, "Forbidden");
    await assert.rejects(service.getFileContent("acme", "atlas-api", "package-lock.json"), /Bitbucket API 403/);
  });

  it("rejects reads when credentials are missing", async () => {
    const service = makeService({});
    await assert.rejects(
      service.getFileContent("acme", "atlas-api", "package-lock.json"),
      (error: any) => error instanceof BitbucketNotConfiguredError,
    );
  });
});
