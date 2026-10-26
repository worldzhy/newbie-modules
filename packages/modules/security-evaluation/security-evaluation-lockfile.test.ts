import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDeclaredDependencies, parsePackageLock } from "./judgment/dependency/security-evaluation-lockfile";

/**
 * Contract tests for the lockfile parser: the only place installed package
 * versions are derived from. The parser must return one entry per installed
 * name@version, carry the dev flag, and refuse a lockfile it cannot read
 * instead of pretending the repository has no dependencies.
 */

function lockfile(packages: Record<string, unknown>): string {
  return JSON.stringify({ lockfileVersion: 3, packages });
}

describe("parsePackageLock", () => {
  it("resolves the transitive tree from the packages map", () => {
    const packages = parsePackageLock(
      lockfile({
        "": { name: "demo", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.20" },
        "node_modules/left-pad/node_modules/lodash": { version: "4.17.21" },
      }),
    );

    assert.deepEqual(packages, [
      { name: "lodash", version: "4.17.20", dev: false },
      { name: "lodash", version: "4.17.21", dev: false },
    ]);
  });

  it("deduplicates the same name@version installed under several paths", () => {
    const packages = parsePackageLock(
      lockfile({
        "node_modules/typescript": { version: "5.9.3", dev: true },
        "node_modules/a/node_modules/typescript": { version: "5.9.3", dev: true },
        "node_modules/b/node_modules/typescript": { version: "5.9.3", dev: true },
      }),
    );

    assert.deepEqual(packages, [{ name: "typescript", version: "5.9.3", dev: true }]);
  });

  it("keeps the dev flag of a development-only package", () => {
    const packages = parsePackageLock(lockfile({ "node_modules/prettier": { version: "3.9.9", dev: true } }));

    assert.deepEqual(packages, [{ name: "prettier", version: "3.9.9", dev: true }]);
  });

  it("rejects a lockfile without the packages map (lockfileVersion 1)", () => {
    const legacy = JSON.stringify({ name: "demo", dependencies: { lodash: { version: "4.17.20" } } });

    assert.throws(() => parsePackageLock(legacy), /lockfileVersion 2\+ required/);
  });

  it("rejects malformed JSON rather than returning an empty set", () => {
    assert.throws(() => parsePackageLock("{ not json"));
  });
});

describe("parseDeclaredDependencies", () => {
  it("merges dependencies and devDependencies into one sorted, deduplicated list", () => {
    const declared = parseDeclaredDependencies(
      JSON.stringify({
        dependencies: { zod: "^3.0.0", lodash: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0", lodash: "^4.0.0" },
      }),
    );

    assert.deepEqual(declared, ["lodash", "typescript", "zod"]);
  });

  it("treats a manifest without dependency blocks as declaring nothing", () => {
    assert.deepEqual(parseDeclaredDependencies("{}"), []);
  });
});
