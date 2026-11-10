import { test } from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { generate, generateSecret } from "otplib";
import { MfaMethod } from "@generated/prisma/client";
import { TwoFactorService } from "./two-factor.service";

/**
 * Behavior tests for the TOTP in-place re-enrollment state machine (ADR-033),
 * plus the at-rest sealing contract (R33-04): the stored columns carry sealed
 * ciphertext, and the service opens them before verifying codes.
 */

const SEALED_PREFIX = "sealed:";

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

  const tokens = {
    sealTotpSecret: (value: string) => `${SEALED_PREFIX}${value}`,
    openTotpSecret: (value: string) => {
      if (!value.startsWith(SEALED_PREFIX)) throw new Error("stored secret is not sealed");
      return value.slice(SEALED_PREFIX.length);
    },
  };

  const service = new TwoFactorService(prisma, tokens as any, null as any, null as any);
  return { service, saved, user };
}

test("setup while TOTP is disabled stores a pending secret and leaves the active secret untouched", async () => {
  const { service, saved } = buildServices({ twoFactorMethod: MfaMethod.NONE });
  const result = await service.setup("user-1");
  assert.ok(typeof saved.pendingTwoFactorSecret === "string" && saved.pendingTwoFactorSecret.length > 0);
  // Only the sealed ciphertext is persisted; the raw secret goes to the user once.
  assert.ok(saved.pendingTwoFactorSecret.startsWith(SEALED_PREFIX));
  assert.equal(saved.pendingTwoFactorSecret, `${SEALED_PREFIX}${result.secret}`);
  // The active secret must NOT be overwritten by setup.
  assert.equal(saved.twoFactorSecret, undefined);
  assert.equal(saved.twoFactorMethod, undefined);
});

test("enable verifies against the opened pending secret and promotes the sealed value verbatim", async () => {
  const secret = generateSecret();
  const { service, saved } = buildServices({ pendingTwoFactorSecret: `${SEALED_PREFIX}${secret}` });

  const code = await generate({ secret });
  await service.enable("user-1", code);

  assert.equal(saved.twoFactorSecret, `${SEALED_PREFIX}${secret}`);
  assert.equal(saved.pendingTwoFactorSecret, null);
  assert.equal(saved.twoFactorMethod, MfaMethod.TOTP);
});

test("setup while TOTP is enabled requires the current password or code", async () => {
  const { service } = buildServices({
    twoFactorMethod: MfaMethod.TOTP,
    twoFactorSecret: `${SEALED_PREFIX}active-secret`,
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
    twoFactorSecret: `${SEALED_PREFIX}active-secret`,
    password: "hashed-password",
  });
  await assert.rejects(
    () => service.disable("user-1", {}),
    (err: any) => err instanceof BadRequestException,
  );
});
