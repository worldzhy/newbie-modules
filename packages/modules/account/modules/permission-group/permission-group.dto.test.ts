import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { CreatePermissionGroupDto, SAFE_ROUTE_PATH_PATTERN, UpdatePermissionGroupDto } from "./permission-group.dto";

/**
 * routePath is stored verbatim and later handed to the frontend header nav as
 * a navigation target, so it crosses three boundaries: this DTO, the backend
 * redirect predicate and the frontend `isSafeInternalPath`. The rejection
 * vectors below are the same table the frontend predicate is tested with, so a
 * drift in any one copy shows up as a failing test rather than a silent
 * open-redirect surface (R27-02).
 */

const REJECTED_PATHS = [
  // Protocol-relative: navigates off-site.
  "//evil.com",
  // Browsers normalize `/\evil.com` into `//evil.com`.
  "/\\evil.com",
  // WHATWG URL parsing strips C0 controls before resolving the reference.
  "/a\nb",
  "/a\tb",
  "/a\rb",
  "/a\u0000b",
  // Absolute and scheme-relative forms.
  "https://evil.com",
  "evil.com",
];

const ACCEPTED_PATHS = ["/projects", "/projects/abc?tab=runs", "/"];

async function invalidProperties(instance: object): Promise<string[]> {
  const errors = await validate(instance);
  return errors.map((error) => error.property).sort();
}

function createPayload(routePath: string): CreatePermissionGroupDto {
  return plainToInstance(CreatePermissionGroupDto, {
    name: "Group",
    routePath,
    navPlacement: "HEADER_NAVIGATION",
    navLabel: "Group",
  });
}

function updatePayload(routePath: string): UpdatePermissionGroupDto {
  return plainToInstance(UpdatePermissionGroupDto, { routePath });
}

test("the pattern matches the frontend predicate instead of a narrower regex", () => {
  assert.equal(SAFE_ROUTE_PATH_PATTERN.test("/projects"), true);
  for (const routePath of REJECTED_PATHS) {
    assert.equal(SAFE_ROUTE_PATH_PATTERN.test(routePath), false, JSON.stringify(routePath));
  }
});

test("create rejects every same-origin violation vector", async () => {
  for (const routePath of REJECTED_PATHS) {
    assert.deepEqual(await invalidProperties(createPayload(routePath)), ["routePath"], JSON.stringify(routePath));
  }
});

test("create accepts same-origin paths", async () => {
  for (const routePath of ACCEPTED_PATHS) {
    assert.deepEqual(await invalidProperties(createPayload(routePath)), [], routePath);
  }
});

test("update rejects the same vectors on its optional routePath", async () => {
  for (const routePath of REJECTED_PATHS) {
    assert.deepEqual(await invalidProperties(updatePayload(routePath)), ["routePath"], JSON.stringify(routePath));
  }
});

test("create and update enforce the 128-character routePath bound", async () => {
  const atCap = `/${"a".repeat(127)}`;
  const pastCap = `/${"a".repeat(128)}`;

  assert.deepEqual(await invalidProperties(createPayload(atCap)), []);
  assert.deepEqual(await invalidProperties(createPayload(pastCap)), ["routePath"]);

  assert.deepEqual(await invalidProperties(updatePayload(atCap)), []);
  assert.deepEqual(await invalidProperties(updatePayload(pastCap)), ["routePath"]);
});
