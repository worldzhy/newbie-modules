import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConfigService } from "@nestjs/config";
import type { ExecutionContext } from "@nestjs/common";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";

import type { TokenService } from "../token/token.service";

import { ApiKeyStrategy } from "./api-key/api-key.strategy";
import { JwtAuthGuard } from "./jwt/jwt.guard";
import { JwtStrategy } from "./jwt/jwt.strategy";

/**
 * ADR-048 §3/§7: a request that carries no credential at all is its own
 * failure — Session_Missing (1105), not a bare uncoded UnauthorizedException.
 * On the previous implementation both cases threw UnauthorizedException, so
 * these assertions fail there: the test is a real negative control.
 */
function assertSessionMissing(error: unknown): boolean {
  assert.ok(error instanceof NewbieException, "expected a coded NewbieException");
  assert.equal((error.getResponse() as { code: number }).code, 1105);
  assert.equal(error.getStatus(), 401);
  return true;
}

describe("auth strategies without a credential", () => {
  it("jwt strategy throws Session_Missing when no access token is present", async () => {
    const config = {
      getOrThrow: () => ({ defaultSecret: "secret", userAccess: { secret: "secret" } }),
    } as unknown as ConfigService;
    const tokenService = {
      getTokenFromHttpRequest: () => undefined,
    } as unknown as TokenService;

    const strategy = new JwtStrategy(config, tokenService);

    await assert.rejects(strategy.validate({} as never), assertSessionMissing);
  });

  it("api-key strategy throws Session_Missing when key or secret header is missing", async () => {
    const strategy = new ApiKeyStrategy();

    await assert.rejects(strategy.validate({ headers: {} } as never), assertSessionMissing);
    await assert.rejects(strategy.validate({ headers: { key: "k" } } as never), assertSessionMissing);
  });

  it("jwt guard maps passport's no-token info to Session_Missing", () => {
    // passport-jwt rejects before validate() and reports "no token" as a plain
    // object, so the strategy's own branch is unreachable for that case; the
    // guard is where the code has to be attached.
    const guard = new JwtAuthGuard();

    assert.throws(
      () => guard.handleRequest(null, false, { message: "No auth token" }, {} as ExecutionContext),
      (error: unknown) => assertSessionMissing(error),
    );
  });

  it("keeps Session_Missing registered as 1105 / HTTP 401", () => {
    const exception = new NewbieException(NewbieExceptionType.Session_Missing);

    assert.equal((exception.getResponse() as { code: number }).code, 1105);
    assert.equal(exception.getStatus(), 401);
  });
});
