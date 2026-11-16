import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LogoutController } from "./logout.controller";
import { IS_PUBLIC_KEY } from "../../security/authentication/public/public.decorator";
import { OWNER_KEY } from "../../security/authorization/require-owner.decorator";
import { CookieName } from "../../security/cookie/cookie.service";

/**
 * Logout contract (R53-01): signing out must work with an expired access
 * token, otherwise the session and the refresh cookie survive a "logout".
 * The guard wiring is the invariant under test, not the revocation helper.
 */
function buildController() {
  const revoked: string[] = [];
  const cleared: string[] = [];
  const controller = new LogoutController(
    {
      clear: (_response: unknown, name: string) => {
        cleared.push(name);
      },
    } as never,
    {
      revokeByRefreshToken: async (token: string) => {
        revoked.push(token);
      },
    } as never,
  );
  return { controller, revoked, cleared, response: {} as never };
}

void describe("LogoutController", () => {
  void it("is exempt from the authentication and ownership guards", () => {
    // The global JWT guard rejected an expired access token and the ownership
    // guard rejected the anonymous request, so a guarded logout could never
    // reach the handler once the access token expired.
    assert.equal(Reflect.getMetadata(IS_PUBLIC_KEY, LogoutController.prototype.logout), true);
    assert.equal(Reflect.getMetadata(OWNER_KEY, LogoutController.prototype.logout), undefined);
  });

  void it("revokes the session named by the refresh token and clears the cookie", async () => {
    const { controller, revoked, cleared, response } = buildController();

    const result = await controller.logout("refresh-token-value", response);

    assert.deepEqual(revoked, ["refresh-token-value"]);
    assert.deepEqual(cleared, [CookieName.REFRESH_TOKEN]);
    assert.deepEqual(result, { data: { message: "User logs out successfully" } });
  });

  void it("stays successful without a refresh token and still clears the cookie", async () => {
    const { controller, revoked, cleared, response } = buildController();

    const result = await controller.logout(undefined, response);

    assert.deepEqual(revoked, []);
    assert.deepEqual(cleared, [CookieName.REFRESH_TOKEN]);
    assert.deepEqual(result, { data: { message: "User logs out successfully" } });
  });
});
