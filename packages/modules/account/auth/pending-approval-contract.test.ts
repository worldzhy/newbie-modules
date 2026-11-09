import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * First-login approval contract (D3 launch policy).
 *
 * Every self-service channel provisions an account that must be accepted by an
 * administrator before it can log in. The rule has two halves that drift
 * independently unless pinned:
 *
 * 1. Provisioning — password sign-up and first Google/Lark/WeChat logins must
 *    create the account as PENDING_APPROVAL instead of ACTIVE. A new channel
 *    that forgets this silently grants access to anyone who can authenticate
 *    upstream.
 * 2. Enforcement — no session may be minted for a PENDING_APPROVAL account.
 *    The check lives in the shared issuance exit (AuthService.issueLoginSession)
 *    so it covers channels that bypass the credential eligibility gates, not
 *    just the ones routed through AuthService.login().
 *
 * The admin-side approval queue also depends on the user list accepting a
 * status filter, which is pinned here for the same reason.
 */

const AUTH_DIR = __dirname;
const ACCOUNT_DIR = join(AUTH_DIR, "..");

/** Files that create accounts on behalf of a self-service identity. */
const SELF_PROVISIONING_FILES = ["auth.service.ts", "lark/lark-auth.service.ts", "wechat/auth.service.ts"];

const PENDING_ASSIGNMENT_PATTERN = /status:\s*UserStatus\.PENDING_APPROVAL/;

function read(relativePath: string): string {
  return readFileSync(join(AUTH_DIR, relativePath), "utf8");
}

describe("first-login approval contract", () => {
  for (const relativePath of SELF_PROVISIONING_FILES) {
    it(`${relativePath}: self-provisioned accounts start as PENDING_APPROVAL`, () => {
      const content = read(relativePath);
      assert.ok(
        PENDING_ASSIGNMENT_PATTERN.test(content),
        `${relativePath} creates a user without status: UserStatus.PENDING_APPROVAL — a self-service ` +
          `first login must wait for administrator approval before the account can be used.`,
      );
    });
  }

  it("auth.service.ts: the shared issuance exit refuses PENDING_APPROVAL before minting a session", () => {
    const content = read("auth.service.ts");
    const gateIndex = content.indexOf("account.status === UserStatus.PENDING_APPROVAL");
    assert.ok(
      gateIndex !== -1,
      "AuthService.issueLoginSession must reject PENDING_APPROVAL; without it the out-of-band channels " +
        "(Lark, WeChat, Google) mint sessions from accounts nobody approved.",
    );

    const issuanceIndex = content.indexOf("async issueLoginSession(");
    const sessionMintIndex = content.indexOf("sessionService.generateWithTransaction", issuanceIndex);
    assert.ok(
      issuanceIndex !== -1 && issuanceIndex < gateIndex && gateIndex < sessionMintIndex,
      "The PENDING_APPROVAL gate must sit inside issueLoginSession before the session is generated.",
    );

    // The rejection must be audited like every other identified-account login
    // failure (see login-audit-coverage.test.ts).
    const window = content.slice(content.lastIndexOf("recordLoginFailure", gateIndex), sessionMintIndex);
    assert.ok(
      window.includes("pending_approval"),
      "The PENDING_APPROVAL rejection must be recorded as a failed login (reason: pending_approval).",
    );
  });

  it("user.dto.ts: the admin user list accepts a status filter for the approval queue", () => {
    const content = readFileSync(join(ACCOUNT_DIR, "modules/user/user.dto.ts"), "utf8");
    const dtoIndex = content.indexOf("export class ListUsersRequestDto");
    assert.ok(dtoIndex !== -1, "ListUsersRequestDto is missing.");
    const dto = content.slice(dtoIndex, content.indexOf("/**", dtoIndex + 10));
    assert.match(
      dto,
      /@IsEnum\(UserStatus\)\s*\n\s*status\?: UserStatus/,
      "ListUsersRequestDto must expose an optional status filter so administrators can list " +
        "PENDING_APPROVAL accounts.",
    );
  });
});
