import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { SessionService } from "./session.service";

/**
 * Behavior tests for SessionService.refresh (ADR-034). Prisma and TokenService
 * are replaced by hand-rolled fakes so the test exercises the rotation CAS,
 * the idempotency window, and genuine-reuse revocation without a database.
 */

function hash(token: string) {
  // Mirror of TokenService.hashToken (sha256 hex) so the fake's stored hashes
  // match what the service computes.
  return createHash("sha256").update(token).digest("hex");
}

function buildServices() {
  const db: Record<number, any> = {
    1: {
      id: 1,
      userId: "user-1",
      accessToken: "old-access",
      refreshTokenHash: hash("old-refresh"),
      previousRefreshTokenHash: null,
      rotatedAt: null,
      refreshTokenNext: null,
    },
  };

  const prisma: any = {
    session: {
      updateMany: async ({ where, data }: any) => {
        const row = Object.values(db).find((s) => s.refreshTokenHash === where.refreshTokenHash);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const row = Object.values(db).find((s) => s.refreshTokenHash === where.refreshTokenHash);
        if (!row) throw new Error("not found");
        return { ...row };
      },
      findFirst: async ({ where }: any) => {
        const row = Object.values(db).find((s) => s.previousRefreshTokenHash === where.previousRefreshTokenHash);
        return row ? { ...row } : null;
      },
      delete: async ({ where }: any) => {
        delete db[where.id];
        return {};
      },
    },
  };

  const tokenService: any = {
    verifyUserRefreshToken: (_token: string) => ({
      userId: "user-1",
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    signUserAccessToken: () => "new-access",
    signUserRefreshToken: () => "new-refresh",
    hashToken: hash,
  };

  const auditLogService: any = { record: async () => {} };

  const service = new SessionService(prisma, null as any, tokenService, auditLogService);
  return { service, db, auditLogService };
}

test("refresh rotates tokens via CAS and returns the new raw refresh token", async () => {
  const { service, db } = buildServices();
  const session = await service.refresh("old-refresh");
  assert.equal(session.refreshToken, "new-refresh");
  assert.equal(session.accessToken, "new-access");
  // The old hash is now the previous hash; the new hash is current.
  assert.equal(db[1].refreshTokenHash, hash("new-refresh"));
  assert.equal(db[1].previousRefreshTokenHash, hash("old-refresh"));
  assert.ok(db[1].rotatedAt);
});

test("a retried refresh within the idempotency window returns the same minted token", async () => {
  const { service, db } = buildServices();
  await service.refresh("old-refresh");
  // Simulate the caller retrying the same (now-rotated-out) token immediately.
  const retry = await service.refresh("old-refresh");
  assert.equal(retry.refreshToken, "new-refresh");
  assert.equal(retry.accessToken, "new-access");
  // The session is still alive — reuse was not treated as theft.
  assert.ok(db[1]);
});

test("a replayed refresh outside the window revokes only that session and 401s", async () => {
  const { service, db, auditLogService } = buildServices();
  await service.refresh("old-refresh");
  // Force the rotation outside the idempotency window.
  db[1].rotatedAt = new Date(Date.now() - 60_000);

  let recorded: any = null;
  auditLogService.record = async (event: string, params: any) => {
    recorded = { event, params };
  };

  await assert.rejects(
    () => service.refresh("old-refresh"),
    (err: any) => err instanceof UnauthorizedException,
  );
  // Only the offending session was deleted, not every session of the user.
  assert.equal(db[1], undefined);
  assert.equal(recorded?.params?.detail?.reason, "refresh_token_reuse");
});
