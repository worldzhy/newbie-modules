import { test } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { TokenService } from "./token.service";

/**
 * R20-11: the refresh-token idempotency window needs the raw credential back,
 * but the database must not hold it. sealToken/openSealedToken provide a
 * reversible, domain-separated AES-256-GCM envelope; these tests pin the
 * round trip and the fail-closed paths.
 */

function buildTokenService(refreshSecret = "b".repeat(40)): TokenService {
  const config = {
    getOrThrow: () => ({
      defaultSecret: "d".repeat(40),
      userAccess: { secret: "a".repeat(40) },
      userRefresh: { secret: refreshSecret },
    }),
  };
  return new TokenService(config as never);
}

test("a sealed token round-trips", () => {
  const tokenService = buildTokenService();
  const sealed = tokenService.sealToken("raw-refresh-token");
  assert.notEqual(sealed, "raw-refresh-token");
  assert.equal(tokenService.openSealedToken(sealed), "raw-refresh-token");
});

test("sealing the same token twice produces different ciphertext", () => {
  const tokenService = buildTokenService();
  assert.notEqual(tokenService.sealToken("raw"), tokenService.sealToken("raw"), "the IV must be random per seal");
});

test("a tampered sealed token is rejected", () => {
  const tokenService = buildTokenService();
  const sealed = tokenService.sealToken("raw-refresh-token");
  const parts = sealed.split(".");
  const payload = Buffer.from(parts[3], "base64url");
  payload[0] ^= 0xff;
  parts[3] = payload.toString("base64url");
  assert.throws(() => tokenService.openSealedToken(parts.join(".")), UnauthorizedException);
});

test("a sealed token cannot be opened with a different key", () => {
  const sealed = buildTokenService("b".repeat(40)).sealToken("raw");
  assert.throws(() => buildTokenService("c".repeat(40)).openSealedToken(sealed), UnauthorizedException);
});

test("malformed sealed values are rejected", () => {
  const tokenService = buildTokenService();
  for (const value of ["", "v1", "v1.a.b", "v2.a.b.c", "v1.!!!.!!!.!!!"]) {
    assert.throws(() => tokenService.openSealedToken(value), UnauthorizedException);
  }
});

// R33-04: TOTP secrets use their own key domain, so a database read yields
// ciphertext and the two sealed families cannot be swapped for one another.
test("a sealed TOTP secret round-trips", () => {
  const tokenService = buildTokenService();
  const sealed = tokenService.sealTotpSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(sealed, "JBSWY3DPEHPK3PXP");
  assert.equal(tokenService.openTotpSecret(sealed), "JBSWY3DPEHPK3PXP");
});

test("TOTP and refresh-token seals are not interchangeable", () => {
  const tokenService = buildTokenService();
  const sealedSecret = tokenService.sealTotpSecret("JBSWY3DPEHPK3PXP");
  const sealedToken = tokenService.sealToken("raw-refresh-token");

  assert.throws(() => tokenService.openSealedToken(sealedSecret), UnauthorizedException);
  assert.throws(() => tokenService.openTotpSecret(sealedToken), UnauthorizedException);
});
