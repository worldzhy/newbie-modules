import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OAuthService } from "./oauth.service";

/**
 * Behavior tests for OAuthService (nightwatch-backend ADR-081, RFC 6749 §4.1
 * + RFC 7636 PKCE). Prisma, TokenService, SessionService and AuditLogService
 * are replaced by hand-rolled fakes so the tests exercise the authorize
 * validation, consent short-circuit, code minting, PKCE verification, replay
 * rejection and scope whitelist intersection without a database.
 */

const S256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function buildServices() {
  const client = {
    clientId: "ledger",
    clientSecretHash: null,
    redirectUris: ["ledger://oauth/callback"],
    scopes: ["identity"],
    description: "Ledger desktop app",
    revokedAt: null,
    createdBy: "admin-1",
  };

  const codes: Record<string, any> = {};
  const consents: Record<string, any> = {};

  const prisma: any = {
    oAuthClient: {
      findUnique: async ({ where }: any) => (where.clientId === client.clientId ? { ...client } : null),
      create: async ({ data }: any) => ({ id: 1, ...data }),
      update: async ({ where, data }: any) => {
        if (where.clientId === client.clientId) Object.assign(client, data);
        return { ...client };
      },
    },
    oAuthAuthorizationCode: {
      findUnique: async ({ where, include }: any) => {
        const row = codes[where.code];
        if (!row) return null;
        return include?.client ? { ...row, client: { ...client } } : { ...row };
      },
      create: async ({ data }: any) => {
        // Mirror Prisma: nullable columns default to null, not undefined, so the
        // updateMany CAS filter `usedAt: null` matches a freshly-issued code.
        codes[data.code] = { ...data, usedAt: null };
        return { ...data };
      },
      updateMany: async ({ where, data }: any) => {
        const row = codes[where.code];
        if (row && row.usedAt === null) {
          Object.assign(row, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    oAuthConsent: {
      findUnique: async ({ where }: any) =>
        consents[`${where.userId_clientId.userId}:${where.userId_clientId.clientId}`] ?? null,
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.userId_clientId.userId}:${where.userId_clientId.clientId}`;
        consents[key] = { ...(consents[key] ?? {}), ...create, ...update };
        return consents[key];
      },
    },
    session: {
      update: async () => ({}),
    },
  };

  const sessionService: any = {
    generate: async () => ({ id: 42, userId: "user-1", accessToken: "access", refreshToken: "refresh" }),
    revokeByRefreshToken: async () => "current",
  };

  const tokenService: any = { generateRandomString: async () => "hashed-secret" };
  const auditLogService: any = { record: async () => {} };

  const service = new OAuthService(prisma, tokenService, sessionService, auditLogService);
  return { service, client, codes, consents };
}

test("authorize rejects a redirect_uri outside the client whitelist", async () => {
  const { service } = buildServices();
  await assert.rejects(
    () =>
      service.authorize({
        userId: "user-1",
        clientId: "ledger",
        redirectUri: "https://evil.example/callback",
        scope: "identity",
        codeChallenge: S256("verifier"),
        codeChallengeMethod: "S256",
        state: "s",
      }),
    (err: any) => err.getResponse?.().error === "invalid_redirect_uri",
  );
});

test("authorize rejects a scope outside the client whitelist", async () => {
  const { service } = buildServices();
  await assert.rejects(
    () =>
      service.authorize({
        userId: "user-1",
        clientId: "ledger",
        redirectUri: "ledger://oauth/callback",
        scope: "identity admin",
        codeChallenge: S256("verifier"),
        codeChallengeMethod: "S256",
        state: "s",
      }),
    (err: any) => err.getResponse?.().error === "invalid_scope",
  );
});

test("authorize requires an S256 PKCE challenge", async () => {
  const { service } = buildServices();
  await assert.rejects(
    () =>
      service.authorize({
        userId: "user-1",
        clientId: "ledger",
        redirectUri: "ledger://oauth/callback",
        scope: "identity",
        codeChallenge: "",
        codeChallengeMethod: "plain",
        state: "s",
      }),
    (err: any) => err.getResponse?.().error === "invalid_request",
  );
});

test("authorize with no standing consent returns a consent challenge", async () => {
  const { service } = buildServices();
  const result = await service.authorize({
    userId: "user-1",
    clientId: "ledger",
    redirectUri: "ledger://oauth/callback",
    scope: "identity",
    codeChallenge: S256("verifier"),
    codeChallengeMethod: "S256",
    state: "s",
  });
  assert.equal(result.requireConsent, true);
});

test("approveConsent persists the standing consent and issues a redirect code", async () => {
  const { service, consents, codes } = buildServices();
  const result = await service.approveConsent({
    userId: "user-1",
    clientId: "ledger",
    scope: "identity",
    redirectUri: "ledger://oauth/callback",
    codeChallenge: S256("verifier"),
    state: "xyz",
  });
  assert.equal(result.requireConsent, false);
  assert.ok(result.code);
  assert.equal(result.state, "xyz");
  assert.equal(consents["user-1:ledger"].scopeGranted, "identity");
  assert.ok(codes[result.code]);
});

test("authorize with a standing covering consent skips the page and redirects", async () => {
  const { service, consents } = buildServices();
  consents["user-1:ledger"] = { userId: "user-1", clientId: "ledger", scopeGranted: "identity", revokedAt: null };
  const result = await service.authorize({
    userId: "user-1",
    clientId: "ledger",
    redirectUri: "ledger://oauth/callback",
    scope: "identity",
    codeChallenge: S256("verifier"),
    codeChallengeMethod: "S256",
    state: "s",
  });
  assert.equal(result.requireConsent, false);
  assert.ok(result.code);
});

test("exchangeCodeForToken mints tokens for a valid code and correct PKCE verifier", async () => {
  const { service, codes } = buildServices();
  const issued = await service.approveConsent({
    userId: "user-1",
    clientId: "ledger",
    scope: "identity",
    redirectUri: "ledger://oauth/callback",
    codeChallenge: S256("verifier"),
    state: "s",
  });
  const token = await service.exchangeCodeForToken({
    code: issued.code,
    redirectUri: "ledger://oauth/callback",
    clientId: "ledger",
    codeVerifier: "verifier",
    ipAddress: "127.0.0.1",
    userAgent: "test",
  });
  assert.equal(token.accessToken, "access");
  assert.equal(token.refreshToken, "refresh");
  assert.equal(token.scope, "identity");
  assert.equal(codes[issued.code].usedAt !== null, true, "code is marked single-use");
});

test("exchangeCodeForToken rejects a wrong PKCE verifier", async () => {
  const { service } = buildServices();
  const issued = await service.approveConsent({
    userId: "user-1",
    clientId: "ledger",
    scope: "identity",
    redirectUri: "ledger://oauth/callback",
    codeChallenge: S256("verifier"),
    state: "s",
  });
  await assert.rejects(
    () =>
      service.exchangeCodeForToken({
        code: issued.code,
        redirectUri: "ledger://oauth/callback",
        clientId: "ledger",
        codeVerifier: "wrong-verifier",
        ipAddress: "127.0.0.1",
        userAgent: "test",
      }),
    (err: any) => err.getResponse?.().error === "invalid_grant",
  );
});

test("exchangeCodeForToken rejects a replayed (already used) code", async () => {
  const { service } = buildServices();
  const issued = await service.approveConsent({
    userId: "user-1",
    clientId: "ledger",
    scope: "identity",
    redirectUri: "ledger://oauth/callback",
    codeChallenge: S256("verifier"),
    state: "s",
  });
  await service.exchangeCodeForToken({
    code: issued.code,
    redirectUri: "ledger://oauth/callback",
    clientId: "ledger",
    codeVerifier: "verifier",
    ipAddress: "127.0.0.1",
    userAgent: "test",
  });
  // Second exchange of the same code must fail.
  await assert.rejects(
    () =>
      service.exchangeCodeForToken({
        code: issued.code,
        redirectUri: "ledger://oauth/callback",
        clientId: "ledger",
        codeVerifier: "verifier",
        ipAddress: "127.0.0.1",
        userAgent: "test",
      }),
    (err: any) => err.getResponse?.().error === "invalid_grant",
  );
});

test("exchangeCodeForToken rejects a redirect_uri mismatch", async () => {
  const { service } = buildServices();
  const issued = await service.approveConsent({
    userId: "user-1",
    clientId: "ledger",
    scope: "identity",
    redirectUri: "ledger://oauth/callback",
    codeChallenge: S256("verifier"),
    state: "s",
  });
  await assert.rejects(
    () =>
      service.exchangeCodeForToken({
        code: issued.code,
        redirectUri: "ledger://other-callback",
        clientId: "ledger",
        codeVerifier: "verifier",
        ipAddress: "127.0.0.1",
        userAgent: "test",
      }),
    (err: any) => err.getResponse?.().error === "invalid_grant",
  );
});

test("createClient rejects a duplicate clientId", async () => {
  const { service } = buildServices();
  await assert.rejects(
    () =>
      service.createClient({
        actorId: "admin-1",
        data: { clientId: "ledger", redirectUris: ["ledger://oauth/callback"], scopes: ["identity"] },
      }),
    (err: any) => err.getResponse?.().error === "invalid_client",
  );
});
