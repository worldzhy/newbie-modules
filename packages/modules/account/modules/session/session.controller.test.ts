import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionController } from "./session.controller";

/**
 * Behavior tests for SessionController credential hygiene: every session
 * endpoint must project through SESSION_PUBLIC_SELECT, so the live access
 * token, the refresh-token hashes and the plaintext `refreshTokenNext` never
 * reach the client even though they live on the same row.
 */

/** Full row as Prisma would return it when no `select` is supplied. */
const ROW = {
  id: 7,
  accessToken: "live-access-jwt",
  refreshTokenHash: "hash-current",
  previousRefreshTokenHash: "hash-previous",
  refreshTokenNext: "plaintext-next-refresh",
  rotatedAt: new Date("2026-10-01T00:00:00Z"),
  ipAddress: "10.0.0.1",
  userAgent: "Mozilla/5.0",
  city: "Shanghai",
  region: "Shanghai",
  timezone: "Asia/Shanghai",
  countryCode: "CN",
  browser: "Chrome 120",
  operatingSystem: "macOS 14",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  userId: "user-1",
};

const CREDENTIAL_KEYS = [
  "accessToken",
  "refreshToken",
  "refreshTokenHash",
  "previousRefreshTokenHash",
  "refreshTokenNext",
  "rotatedAt",
];

/** Mimic Prisma's projection so the double returns exactly what a select asks for. */
function project(row: Record<string, unknown>, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, wanted] of Object.entries(select)) {
    if (wanted) out[key] = row[key];
  }
  return out;
}

function buildController() {
  const calls: any[] = [];
  const auditEvents: any[] = [];
  const prisma: any = {
    findManyInManyPages: async (args: any) => {
      calls.push({ op: "findMany", args });
      return {
        records: [project(ROW, args.findManyArgs.select)],
        pagination: { page: 0, pageSize: 20, countOfCurrentPage: 1, countOfTotal: 1 },
      };
    },
    session: {
      findUnique: async (args: any) => {
        calls.push({ op: "findUnique", args });
        return args.where.id === ROW.id ? project(ROW, args.select) : null;
      },
      delete: async (args: any) => {
        calls.push({ op: "delete", args });
        return project(ROW, args.select);
      },
    },
  };
  const auditLogService: any = {
    record: async (event: string, params: any) => {
      auditEvents.push({ event, params });
    },
  };
  return { controller: new SessionController(prisma, auditLogService), calls, auditEvents };
}

function request(sessionId: number) {
  return { user: { userId: "user-1", sessionId }, ip: "127.0.0.1", headers: {} } as any;
}

function assertNoCredentials(payload: Record<string, unknown>) {
  for (const key of CREDENTIAL_KEYS) {
    assert.equal(key in payload, false, `credential field '${key}' must not be returned`);
  }
}

test("list returns display columns only and flags the current session", async () => {
  const { controller, calls } = buildController();

  const result = await controller.list(request(ROW.id), "user-1", { page: 0, pageSize: 20 } as any);

  const args = calls[0].args;
  assert.equal(calls[0].op, "findMany");
  assert.equal(args.model, "Session");
  assert.ok(args.findManyArgs.select, "list must project through an explicit select");
  assert.equal(result.records.length, 1);
  const record = result.records[0] as unknown as Record<string, unknown>;
  assertNoCredentials(record);
  assert.equal(record.ipAddress, ROW.ipAddress);
  assert.equal(record.browser, ROW.browser);
  assert.equal(record.isCurrentSession, true);
});

test("list marks a different session as not current", async () => {
  const { controller } = buildController();

  const result = await controller.list(request(99), "user-1", { page: 0, pageSize: 20 } as any);

  assert.equal((result.records[0] as any).isCurrentSession, false);
});

test("get projects the row and never returns credentials", async () => {
  const { controller, calls } = buildController();

  const session = await controller.get(request(99), "user-1", ROW.id);

  const args = calls[0].args;
  assert.ok(args.select, "get must project through an explicit select");
  const payload = session as unknown as Record<string, unknown>;
  assertNoCredentials(payload);
  assert.equal(payload.userId, "user-1");
  assert.equal(payload.isCurrentSession, false);
});

test("get 404s for a session owned by another user", async () => {
  const { controller } = buildController();

  await assert.rejects(
    () => controller.get(request(99), "user-1", 12345),
    (err: any) => err?.status === 404,
  );
});

test("remove deletes through the public projection and audits the revocation", async () => {
  const { controller, calls, auditEvents } = buildController();

  const deleted = await controller.remove(request(99), "user-1", ROW.id);

  const deleteCall = calls.find((call) => call.op === "delete");
  assert.ok(deleteCall, "remove must delete the row");
  assert.ok(deleteCall.args.select, "remove must project the deleted row");
  assertNoCredentials(deleted as unknown as Record<string, unknown>);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].event, "session.revoked");
  assert.equal(auditEvents[0].params.detail.sessionOwnerId, "user-1");
});
