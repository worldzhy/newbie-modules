import assert from "node:assert/strict";
import { test } from "node:test";

import { UnauthorizedException } from "@nestjs/common";
import { UserStatus } from "@generated/prisma/client";
import { generateHash } from "@devbie/newbie/utilities/common.util";
import {
  API_KEY_NOT_FOUND,
  INVALID_CREDENTIALS,
  UNAUTHORIZED_RESOURCE,
} from "@devbie/newbie/exceptions/errors.constants";

import { AccountApiKeyVerifier } from "./api-key.verifier";

/**
 * Contract test for N-1: the verification path itself (not a cache helper) must
 * reject a personal key whose owner is no longer ACTIVE.
 */

const SECRET = "plaintext-secret";
const KEY = "api-key-1";

function buildVerifier(apiKey: Record<string, unknown> | null, owner: { status: UserStatus } | null) {
  const calls = { user: 0 };
  const prisma = {
    apiKey: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        apiKey !== null && where.key === apiKey.key ? apiKey : null,
    },
    user: {
      findUnique: async () => {
        calls.user += 1;
        return owner;
      },
    },
  };
  return { verifier: new AccountApiKeyVerifier(prisma as never), calls };
}

test("accepts a personal key whose owner is ACTIVE", async () => {
  const apiKey = { id: 1, key: KEY, secret: await generateHash(SECRET), userId: "user-1" };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  assert.equal(await verifier.verify(KEY, SECRET), true);
});

test("rejects a personal key whose owner is INACTIVE", async () => {
  const apiKey = { id: 1, key: KEY, secret: await generateHash(SECRET), userId: "user-1" };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.INACTIVE });

  await assert.rejects(
    verifier.verify(KEY, SECRET),
    (error: unknown) => error instanceof UnauthorizedException && error.message === UNAUTHORIZED_RESOURCE,
  );
});

test("rejects a personal key whose owner row is gone", async () => {
  const apiKey = { id: 1, key: KEY, secret: await generateHash(SECRET), userId: "user-1" };
  const { verifier } = buildVerifier(apiKey, null);

  await assert.rejects(
    verifier.verify(KEY, SECRET),
    (error: unknown) => error instanceof UnauthorizedException && error.message === UNAUTHORIZED_RESOURCE,
  );
});

test("rejects a wrong secret with an active owner", async () => {
  const apiKey = { id: 1, key: KEY, secret: await generateHash("other-secret"), userId: "user-1" };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  await assert.rejects(
    verifier.verify(KEY, SECRET),
    (error: unknown) => error instanceof UnauthorizedException && error.message === INVALID_CREDENTIALS,
  );
});

test("rejects an unknown key without touching the user table", async () => {
  const { verifier, calls } = buildVerifier(null, null);

  await assert.rejects(
    verifier.verify(KEY, SECRET),
    (error: unknown) => error instanceof UnauthorizedException && error.message === API_KEY_NOT_FOUND,
  );
  assert.equal(calls.user, 0);
});

/**
 * Restriction wiring (round 27, P2-2). api-key-restrictions.test.ts covers the
 * pure matchers, but nothing proved verify() actually consults the stored
 * columns: deleting both branches left the suite green. These cases call the
 * verifier with a request context, the way ApiKeyStrategy does.
 */

test("accepts a key whose IP restriction covers the caller", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    ipRestrictions: ["203.0.113.0/24"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  assert.equal(await verifier.verify(KEY, SECRET, { ipAddress: "203.0.113.9" }), true);
});

test("rejects a key used from outside its IP restriction", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    ipRestrictions: ["203.0.113.0/24"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  await assert.rejects(
    verifier.verify(KEY, SECRET, { ipAddress: "198.51.100.7" }),
    (error: unknown) => error instanceof UnauthorizedException && error.message === UNAUTHORIZED_RESOURCE,
  );
});

test("rejects a restricted key when the caller supplies no context", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    ipRestrictions: ["203.0.113.0/24"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  await assert.rejects(
    verifier.verify(KEY, SECRET),
    (error: unknown) => error instanceof UnauthorizedException && error.message === UNAUTHORIZED_RESOURCE,
  );
});

test("accepts a key whose referrer restriction matches the origin", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    referrerRestrictions: ["https://app.example.com"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  assert.equal(await verifier.verify(KEY, SECRET, { origin: "https://app.example.com" }), true);
});

test("accepts a key matched through the referer when Origin is absent", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    referrerRestrictions: ["app.example.com"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  assert.equal(await verifier.verify(KEY, SECRET, { referrer: "https://app.example.com/dashboard" }), true);
});

test("rejects a key used from a foreign origin", async () => {
  const apiKey = {
    id: 1,
    key: KEY,
    secret: await generateHash(SECRET),
    userId: "user-1",
    referrerRestrictions: ["https://app.example.com"],
  };
  const { verifier } = buildVerifier(apiKey, { status: UserStatus.ACTIVE });

  await assert.rejects(
    verifier.verify(KEY, SECRET, { origin: "https://evil.example.com" }),
    (error: unknown) => error instanceof UnauthorizedException && error.message === UNAUTHORIZED_RESOURCE,
  );
});
