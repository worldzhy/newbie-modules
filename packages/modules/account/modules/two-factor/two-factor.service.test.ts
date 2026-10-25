import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { MfaMethod } from "@generated/prisma/client";
import { TwoFactorService } from "./two-factor.service";

/**
 * Behavior tests for the TOTP in-place re-enrollment state machine (ADR-033).
 * Covers the guard invariants that do not require a valid TOTP code: re-bind
 * requires the current credential, a missing pending secret cannot be enabled,
 * and the active secret is never stored during setup.
 */

function buildServices(userOverrides: Record<string, unknown> = {}) {
  const user: any = {
    id: "user-1",
    email: "user@example.com",
    twoFactorMethod: MfaMethod.NONE,
    twoFactorSecret: null,
    pendingTwoFactorSecret: null,
    password: null,
    ...userOverrides,
  };

  const saved: any = {};

  const prisma: any = {
    user: {
      findUniqueOrThrow: async () => ({ ...user }),
      update: async (args: any) => {
        Object.assign(saved, args.data);
        Object.assign(user, args.data);
        return { ...user };
      },
    },
  };

  const service = new TwoFactorService(prisma, null as any, null as any, null as any);
  return { service, saved, user };
}

test("setup while TOTP is disabled stores a pending secret and leaves the active secret untouched", async () => {
  const { service, saved } = buildServices({ twoFactorMethod: MfaMethod.NONE });
  await service.setup("user-1");
  assert.ok(typeof saved.pendingTwoFactorSecret === "string" && saved.pendingTwoFactorSecret.length > 0);
  // The active secret must NOT be overwritten by setup.
  assert.equal(saved.twoFactorSecret, undefined);
  assert.equal(saved.twoFactorMethod, undefined);
});

test("setup while TOTP is enabled requires the current password or code", async () => {
  const { service } = buildServices({
    twoFactorMethod: MfaMethod.TOTP,
    twoFactorSecret: "active-secret",
    password: "hashed-password",
  });
  await assert.rejects(
    () => service.setup("user-1"),
    (err: any) =>
      err instanceof BadRequestException && /current password or a valid authenticator code/.test(err.message),
  );
});

test("enable without a pending secret is rejected", async () => {
  const { service } = buildServices({ pendingTwoFactorSecret: null });
  await assert.rejects(
    () => service.enable("user-1", "000000"),
    (err: any) => err instanceof BadRequestException,
  );
});

test("disable without a current credential is rejected", async () => {
  const { service } = buildServices({
    twoFactorMethod: MfaMethod.TOTP,
    twoFactorSecret: "active-secret",
    password: "hashed-password",
  });
  await assert.rejects(
    () => service.disable("user-1", {}),
    (err: any) => err instanceof BadRequestException,
  );
});
