import assert from "node:assert/strict";
import { test } from "node:test";

import { AccountPermissionAuthorizer } from "./permission.authorizer";

/**
 * Contract test for ADR-048: a resolved scope is the sole criterion, and
 * system-level grants only decide routes without scope semantics.
 *
 * The fake prisma answers the two UNION grant lookups, the fake config is the
 * rbac kill switch and the fake checker records whether it was consulted. The
 * cases pin the combinations that used to collapse into "grant wins".
 */

function fakePrisma(grants: { direct?: boolean; group?: boolean }) {
  return {
    permission: { findFirst: async () => (grants.direct ? { id: "direct-grant" } : null) },
    permissionGroupPermission: { findFirst: async () => (grants.group ? { id: "group-grant" } : null) },
  };
}

function fakeConfig(rbacEnabled = true) {
  return { get: () => rbacEnabled };
}

function fakeChecker(decision: boolean) {
  const calls: Array<{ resource: string; action: string; scope: unknown }> = [];
  return {
    calls,
    check: async (_userId: string, resource: string, action: string, scope: unknown) => {
      calls.push({ resource, action, scope });
      return decision;
    },
  };
}

function authorizer(grants: { direct?: boolean; group?: boolean }, checkerDecision?: boolean, rbacEnabled = true) {
  const checker = checkerDecision === undefined ? undefined : fakeChecker(checkerDecision);
  const instance = new AccountPermissionAuthorizer(
    fakePrisma(grants) as never,
    fakeConfig(rbacEnabled) as never,
    checker as never,
  );
  return { instance, checker };
}

const PROJECT_SCOPE = { type: "project", id: "project-1" } as const;

test("a resolved scope denies even when the caller holds a system-level grant", async () => {
  const { instance, checker } = authorizer({ direct: true, group: true }, false);

  const allowed = await instance.authorize("user-1", { resource: "Task", action: "Update" }, PROJECT_SCOPE);

  assert.equal(allowed, false);
  assert.equal(checker?.calls.length, 1);
  assert.deepEqual(checker?.calls[0], { resource: "Task", action: "Update", scope: PROJECT_SCOPE });
});

test("a resolved scope allows a caller with no system-level grant", async () => {
  const { instance, checker } = authorizer({}, true);

  const allowed = await instance.authorize("user-1", { resource: "Task", action: "Update" }, PROJECT_SCOPE);

  assert.equal(allowed, true);
  assert.equal(checker?.calls.length, 1);
});

test("a `none` scope is denied and never falls back to a grant", async () => {
  const { instance, checker } = authorizer({ direct: true, group: true }, true);

  const allowed = await instance.authorize("user-1", { resource: "Task", action: "List" }, { type: "none" });

  assert.equal(allowed, false);
  assert.equal(checker?.calls.length, 0);
});

test("a scoped decision without a bound checker is denied, not downgraded", async () => {
  const { instance } = authorizer({ direct: true });

  const allowed = await instance.authorize("user-1", { resource: "Task", action: "List" }, PROJECT_SCOPE);

  assert.equal(allowed, false);
});

test("routes without scope keep the system-level grant behaviour", async () => {
  const { instance, checker } = authorizer({ group: true }, false);

  const allowed = await instance.authorize("user-1", { resource: "Permission", action: "List" });

  assert.equal(allowed, true);
  assert.equal(checker?.calls.length, 0);
});

test("no scope and no grant is denied", async () => {
  const { instance } = authorizer({}, true);

  const allowed = await instance.authorize("user-1", { resource: "Permission", action: "List" });

  assert.equal(allowed, false);
});

test("the rbac kill switch still short-circuits every combination", async () => {
  const { instance, checker } = authorizer({}, false, false);

  const allowed = await instance.authorize("user-1", { resource: "Task", action: "Delete" }, PROJECT_SCOPE);

  assert.equal(allowed, true);
  assert.equal(checker?.calls.length, 0);
});
