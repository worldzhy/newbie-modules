import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";

import { UserController } from "./user.controller";

/**
 * Admin-edits-member contract (ADR-043 follow-up).
 *
 * The builtin role model collapsed to ADMIN and MEMBER. ADMIN holds MEMBER's
 * atoms through the derived "All" group but does not literally hold the MEMBER
 * role, so a role-name comparison on the update path rejected every ADMIN edit
 * of a MEMBER — including a status-only edit, because the form submits the
 * unchanged role set. These cases pin the atom-based comparison: reach is a
 * permission property, not a label property.
 */

interface RoleAtom {
  action: string;
  resource: string;
}

function roleRow(name: string, groupAtoms: RoleAtom[], directAtoms: RoleAtom[] = []) {
  return {
    name,
    permissions: directAtoms,
    rolePermissionGroups: groupAtoms.length === 0 ? [] : [{ permissionGroup: { permissions: groupAtoms } }],
  };
}

const ADMIN_ATOMS: RoleAtom[] = [
  { action: "List", resource: "User" },
  { action: "Get", resource: "User" },
  { action: "Create", resource: "User" },
  { action: "Update", resource: "User" },
  { action: "Delete", resource: "User" },
  { action: "Update", resource: "Project" },
];

const MEMBER_ATOMS: RoleAtom[] = [{ action: "Update", resource: "Project" }];

const ROLE_ROWS = [
  roleRow("ADMIN", ADMIN_ATOMS),
  roleRow("MEMBER", MEMBER_ATOMS),
  // A narrowly scoped role that can manage users but nothing else.
  roleRow("IAM_ONLY", [{ action: "Update", resource: "User" }]),
];

function fakeController(input: { callerRoles: string[]; targetRoles: string[] }) {
  const updateCalls: Record<string, unknown>[] = [];

  const prisma = {
    role: {
      findMany: async ({ where }: { where: { name: { in: string[] } } }) =>
        ROLE_ROWS.filter((role) => where.name.in.includes(role.name)),
    },
    user: {
      findUniqueOrThrow: async () => ({
        roles: input.targetRoles.map((name) => ({ role: { name } })),
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateCalls.push(data);
        return {
          id: "target-user",
          email: "member@example.com",
          status: "INACTIVE",
          roles: input.targetRoles.map((name) => ({ role: { name } })),
        };
      },
    },
  };

  const userService = { withoutPassword: (user: Record<string, unknown>) => user };
  const auditLogService = { record: async () => undefined };

  const controller = new UserController(prisma as never, userService as never, {} as never, auditLogService as never);

  return { controller, updateCalls };
}

function request(callerRoles: string[]) {
  return {
    user: { userId: "caller-user", sessionId: 1, roles: callerRoles },
    ip: "127.0.0.1",
    headers: {},
  } as never;
}

test("an ADMIN may save a status change on a MEMBER while resubmitting the unchanged role", async () => {
  const { controller, updateCalls } = fakeController({
    callerRoles: ["ADMIN"],
    targetRoles: ["MEMBER"],
  });

  const result = await controller.updateUser(
    "target-user",
    { roles: ["MEMBER"], status: "INACTIVE" } as never,
    request(["ADMIN"]),
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].status, "INACTIVE");
  assert.deepEqual(result.roles, ["MEMBER"]);
});

test("a role without MEMBER's atoms may not change a MEMBER's roles", async () => {
  const { controller, updateCalls } = fakeController({
    callerRoles: ["IAM_ONLY"],
    targetRoles: ["MEMBER"],
  });

  await assert.rejects(
    controller.updateUser("target-user", { roles: ["MEMBER"] } as never, request(["IAM_ONLY"])),
    (error: unknown) =>
      error instanceof ForbiddenException && /roles you do not have: MEMBER/.test((error as Error).message),
  );
  assert.equal(updateCalls.length, 0);
});

test("a role without ADMIN's atoms may not grant ADMIN", async () => {
  const { controller, updateCalls } = fakeController({
    callerRoles: ["IAM_ONLY"],
    targetRoles: ["IAM_ONLY"],
  });

  await assert.rejects(
    controller.updateUser("target-user", { roles: ["ADMIN"] } as never, request(["IAM_ONLY"])),
    (error: unknown) =>
      error instanceof ForbiddenException &&
      /roles whose permissions you do not hold: ADMIN/.test((error as Error).message),
  );
  assert.equal(updateCalls.length, 0);
});
