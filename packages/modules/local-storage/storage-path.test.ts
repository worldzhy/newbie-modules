import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as path from "node:path";
import { assertSafeFileName, resolveStoragePath, UnsafeFileNameError } from "./storage-path";

const ROOT = "/var/storage/local";

test("normal names resolve under the root", () => {
  assert.equal(resolveStoragePath(ROOT, ["reports"]), path.join(ROOT, "reports"));
  assert.equal(resolveStoragePath(ROOT, ["reports", "q1.pdf"]), path.join(ROOT, "reports", "q1.pdf"));
});

test("traversal tokens are rejected", () => {
  assert.throws(() => assertSafeFileName(".."), UnsafeFileNameError);
  assert.throws(() => assertSafeFileName("../etc"), UnsafeFileNameError);
  assert.throws(() => assertSafeFileName("sub/../../x"), UnsafeFileNameError);
  assert.throws(() => assertSafeFileName("windows\\path"), UnsafeFileNameError);
  assert.throws(() => assertSafeFileName("evil\0name"), UnsafeFileNameError);
  assert.throws(() => assertSafeFileName(""), UnsafeFileNameError);
});

test("absolute-looking names cannot escape the root", () => {
  // Even if validation were bypassed, the containment check catches it.
  assert.throws(() => resolveStoragePath(ROOT, ["/etc/passwd"]), UnsafeFileNameError);
  assert.throws(() => resolveStoragePath(ROOT, ["a", "../../../tmp"]), UnsafeFileNameError);
});

test("a sibling directory sharing the root prefix is not accepted", () => {
  // /var/storage/local-evil must not pass a naive startsWith(root) check.
  assert.throws(() => resolveStoragePath(ROOT, ["../local-evil/x"]), UnsafeFileNameError);
});
