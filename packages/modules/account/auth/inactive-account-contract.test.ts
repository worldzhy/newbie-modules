import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Inactive-account rejection contract.
 *
 * INACTIVE means an administrator disabled the account; a rejected
 * application is deleted instead. The state must therefore read the same to
 * the client on every channel. Before this contract it did not: password and
 * verification-code logins raised NewbieException(Login_InactiveUser) with a
 * "you have closed your account" message, and Lark OAuth answered 401, so one
 * account state surfaced as three different outcomes.
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

const SHARED_REJECTION_PATTERN = /new ForbiddenException\(INACTIVE_ACCOUNT_MESSAGE\)/;
const LEGACY_REJECTION_PATTERN =
  /new (UnauthorizedException|NewbieException)\(.*(Login_InactiveUser|account is not active)/;

describe("inactive-account rejection contract", () => {
  for (const relativePath of INACTIVE_REJECTION_FILES) {
    it(`${relativePath}: INACTIVE is rejected with the shared 403 body`, () => {
      const content = readFileSync(join(AUTH_DIR, relativePath), "utf8");
      assert.match(
        content,
        SHARED_REJECTION_PATTERN,
        `${relativePath} must reject an INACTIVE account with ` +
          `ForbiddenException(INACTIVE_ACCOUNT_MESSAGE) so every channel reports the same 403 body.`,
      );
      assert.doesNotMatch(
        content,
        LEGACY_REJECTION_PATTERN,
        `${relativePath} still rejects INACTIVE with a legacy status/message; converge it on ` +
          `ForbiddenException(INACTIVE_ACCOUNT_MESSAGE).`,
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
