import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NewbieException, NewbieExceptionType, newbieExceptionCode } from "@devbie/newbie/exceptions/newbie.exception";
import { SessionService } from "./session.service";

/**
 * Behavior tests for SessionService (nightwatch-backend ADR-034). Prisma and TokenService
 * are replaced by hand-rolled fakes so the test exercises the rotation CAS,
 * the idempotency window, genuine-reuse revocation, and the two revoke
 * predicates without a database.
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
      refreshTokenHash: hash("old-refresh"),
      previousRefreshTokenHash: null,
      rotatedAt: null,
      refreshTokenNextSealed: null,
    },
    // A session whose browser still holds the previous generation: the row
    // moved on, the cookie did not. Only logout is allowed to match it.
    2: {
      id: 2,
      userId: "user-2",
      refreshTokenHash: hash("current-token"),
      previousRefreshTokenHash: hash("previous-token"),
      rotatedAt: null,
      refreshTokenNextSealed: null,
    },
  };

  const matches = (row: any, where: any): boolean => {
    if (where.OR) return where.OR.some((clause: any) => matches(row, clause));
    return (
      (where.refreshTokenHash === undefined || row.refreshTokenHash === where.refreshTokenHash) &&
      (where.previousRefreshTokenHash === undefined || row.previousRefreshTokenHash === where.previousRefreshTokenHash)
    );
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
        const row = Object.values(db).find((s) => matches(s, where));
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
    // Mirrors the real service: the value at rest is not the raw credential.
    sealToken: (token: string) => `sealed:${token}`,
    openSealedToken: (sealed: string) => sealed.replace(/^sealed:/, ""),
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
  assert.equal(db[1].refreshTokenNextSealed, "sealed:new-refresh");
  assert.notEqual(db[1].refreshTokenNextSealed, "new-refresh", "the raw token must not be stored");
  assert.ok(db[1].rotatedAt);
  // Refreshing must not touch a stored access token: the credential names the
  // session by id and is never persisted (devbie ADR-051).
  assert.equal(db[1].accessToken, undefined);
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

test("a replay 45s after rotation lands inside the 60s window and does not extend it (ADR-055)", async () => {
  const { service, db } = buildServices();
  await service.refresh("old-refresh");

  const rotatedAt = new Date(Date.now() - 45_000);
  db[1].rotatedAt = rotatedAt;

  const replay = await service.refresh("old-refresh");

  assert.equal(replay.refreshToken, "new-refresh");
  // A replay must not push the window forward: every replay stays bounded by
  // the first rotation, so the redeemable span never grows.
  assert.equal(db[1].rotatedAt, rotatedAt);
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
    (err: any) =>
      err instanceof NewbieException &&
      err.getStatus() === 401 &&
      (err.getResponse() as { code: number }).code === newbieExceptionCode(NewbieExceptionType.Session_RefreshRejected),
  );
  // Only the offending session was deleted, not every session of the user.
  assert.equal(db[1], undefined);
  assert.equal(recorded?.params?.detail?.reason, "refresh_token_reuse");
});

test("revokeByRefreshToken revokes the session holding the current token", async () => {
  const { service, db } = buildServices();

  assert.equal(await service.revokeByRefreshToken("current-token"), "current");
  assert.equal(db[2], undefined);
});

test("revokeByRefreshToken does not fall back to the previous generation by default", async () => {
  const { service, db } = buildServices();

  // The refresh-token strategy's expiry path: an old credential must not become
  // a way to delete a live session.
  assert.equal(await service.revokeByRefreshToken("previous-token"), "none");
  assert.ok(db[2]);
});

test("logout's allowPrevious revokes the session the browser still points at", async () => {
  const { service, db, auditLogService } = buildServices();
  let recorded: any = null;
  auditLogService.record = async (event: string, params: any) => {
    recorded = { event, params };
  };

  const matched = await service.revokeByRefreshToken("previous-token", {
    allowPrevious: true,
    auditReason: "logout",
  });

  assert.equal(matched, "previous");
  assert.equal(db[2], undefined);
  assert.equal(recorded?.params?.detail?.reason, "logout");
  assert.equal(recorded?.params?.detail?.matched, "previous");
  assert.equal(recorded?.params?.actorId, "user-2");
});

test("routine expiry revokes without an audit entry", async () => {
  const { service, db, auditLogService } = buildServices();
  let recorded: any = null;
  auditLogService.record = async (event: string, params: any) => {
    recorded = { event, params };
  };

  assert.equal(await service.revokeByRefreshToken("current-token"), "current");

  assert.equal(db[2], undefined);
  assert.equal(recorded, null);
});

test("revokeByRefreshToken reports none for an unknown token and touches nothing", async () => {
  const { service, db } = buildServices();

  const matched = await service.revokeByRefreshToken("unknown-token", {
    allowPrevious: true,
    auditReason: "logout",
  });

  assert.equal(matched, "none");
  assert.ok(db[1] && db[2]);
});
