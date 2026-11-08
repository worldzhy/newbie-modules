import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeRedirectPath, MAX_REDIRECT_PATH_LENGTH } from "./redirect-path";

/**
 * The redirect destination crosses the OAuth handshake as an untrusted query
 * parameter and is handed back to the frontend, so every path to an open
 * redirect must be rejected here as well as in the frontend predicate.
 */
describe("isSafeRedirectPath", () => {
  it("accepts same-origin relative paths", () => {
    assert.equal(isSafeRedirectPath("/"), true);
    assert.equal(isSafeRedirectPath("/projects/abc?tab=findings"), true);
    assert.equal(isSafeRedirectPath("/a/b#c"), true);
  });

  it("rejects absolute and protocol-relative URLs", () => {
    assert.equal(isSafeRedirectPath("https://evil.com"), false);
    assert.equal(isSafeRedirectPath("//evil.com"), false);
    assert.equal(isSafeRedirectPath("javascript:alert(1)"), false);
    assert.equal(isSafeRedirectPath("  /lazy"), false);
  });

  it("rejects backslashes browsers would normalise into an authority", () => {
    assert.equal(isSafeRedirectPath("/\\evil.com"), false);
    assert.equal(isSafeRedirectPath("/a/b\\c"), false);
  });

  it("rejects control characters that would break cookie serialisation", () => {
    assert.equal(isSafeRedirectPath("/a\nb"), false);
    assert.equal(isSafeRedirectPath("/a\rb"), false);
    assert.equal(isSafeRedirectPath("/a\u0000b"), false);
  });

  it("rejects empty, non-string and oversized values", () => {
    assert.equal(isSafeRedirectPath(""), false);
    assert.equal(isSafeRedirectPath(null), false);
    assert.equal(isSafeRedirectPath(undefined), false);
    assert.equal(isSafeRedirectPath(["/a", "/b"]), false);
    assert.equal(isSafeRedirectPath(`/${"a".repeat(MAX_REDIRECT_PATH_LENGTH)}`), false);
    assert.equal(isSafeRedirectPath(`/${"a".repeat(MAX_REDIRECT_PATH_LENGTH - 1)}`), true);
  });
});
