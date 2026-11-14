import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NewbieException, NewbieExceptionType, newbieExceptionCode } from "@devbie/newbie/exceptions/newbie.exception";
import { inactiveAccountError, isInactiveAccountError } from "./inactive-account";

/**
 * Inactive-account rejection contract (devbie ADR-048).
 *
 * INACTIVE means an administrator disabled the account; a rejected
 * application is deleted instead. Every channel must surface it as the coded
 * 403 `Account_Disabled` (1008), so the client treats it as an account block
 * and can tell it apart from `Account_Closed` (1007), which the owner may
 * recover. Before this contract one account state surfaced as three different
 * outcomes depending on the login channel.
 */

const AUTH_DIR = __dirname;

const INACTIVE_REJECTION_FILES = [
  "auth.service.ts",
  "lark/lark-auth.service.ts",
  "strategies/password.strategy.ts",
  "strategies/verification-code.strategy.ts",
  "strategies/refresh-token.strategy.ts",
  "../security-ports/access-token-session.resolver.ts",
];

/**
 * OAuth callbacks are top-level browser navigations: a thrown rejection would
 * paint the raw 403 envelope as the page. They must redirect back to the login
 * page with a notice instead.
 */
const OAUTH_CALLBACK_FILES = ["login-by-lark.controller.ts", "login-by-google.controller.ts"];

const SHARED_REJECTION_PATTERN = /throw inactiveAccountError\(\);/;
const LEGACY_REJECTION_PATTERN = /INACTIVE_ACCOUNT_MESSAGE|Login_InactiveUser|reason: "inactive_user"/;

describe("inactive-account rejection contract", () => {
  it("the shared rejection carries the coded 403 disabled-account contract", () => {
    const error = inactiveAccountError();

    assert.ok(error instanceof NewbieException);
    assert.equal(error.getStatus(), 403);

    const response = error.getResponse() as { code: number; error: { message: string } };
    assert.equal(response.code, newbieExceptionCode(NewbieExceptionType.Account_Disabled));
    assert.equal(response.code, 1008);
    assert.ok(response.error.message.length > 0);
  });

  it("recognises both closed and disabled account rejections", () => {
    assert.equal(isInactiveAccountError(inactiveAccountError()), true);
    assert.equal(isInactiveAccountError(new NewbieException(NewbieExceptionType.Account_Closed)), true);
  });

  it("does not treat unrelated failures as an inactive account", () => {
    assert.equal(isInactiveAccountError(new NewbieException(NewbieExceptionType.Session_Revoked)), false);
    assert.equal(isInactiveAccountError(new Error("boom")), false);
    assert.equal(isInactiveAccountError(undefined), false);
  });

  for (const relativePath of INACTIVE_REJECTION_FILES) {
    it(`${relativePath}: INACTIVE is rejected with the shared coded body`, () => {
      const content = readFileSync(join(AUTH_DIR, relativePath), "utf8");
      assert.match(
        content,
        SHARED_REJECTION_PATTERN,
        `${relativePath} must reject an INACTIVE account with inactiveAccountError() so every ` +
          `channel reports the same Account_Disabled (1008) body.`,
      );
      assert.doesNotMatch(
        content,
        LEGACY_REJECTION_PATTERN,
        `${relativePath} still uses a legacy inactive-account status/message/audit reason; converge it ` +
          `on inactiveAccountError() and the account_disabled audit reason.`,
      );
    });
  }

  for (const relativePath of OAUTH_CALLBACK_FILES) {
    it(`${relativePath}: an INACTIVE rejection returns the browser to the login notice`, () => {
      const content = readFileSync(join(AUTH_DIR, relativePath), "utf8");
      assert.match(
        content,
        /isInactiveAccountError\(error\)/,
        `${relativePath} must detect the shared inactive-account rejection; otherwise the OAuth ` +
          `callback renders the raw 403 JSON as the page.`,
      );
      assert.match(
        content,
        /redirect\(`\$\{frontendUrl\}\/account\/login\?inactive=1`\)/,
        `${relativePath} must redirect an INACTIVE account to the login page notice.`,
      );
    });
  }
});
