import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Login audit coverage contract.
 *
 * Hardens a finding from the 2026-10 audit review: WeChat login had zero
 * audit instrumentation (neither success nor failure), and the Lark OAuth
 * INACTIVE branch silently skipped the failure audit while the equivalent
 * Google OAuth branch was covered. Both were only caught by manual code
 * reading, not by any test, which is exactly the gap this contract closes.
 *
 * Adding a new login channel must add its file to LOGIN_ENTRY_FILES below;
 * that is the intended, reviewable way to extend this contract (see
 * worldzhy-knowledge memory/user_profile.md, "工程治理").
 *
 * Three checks run per file:
 * 1. Rejection coverage — every rejection of an *already identified* account
 *    (UnauthorizedException/BadRequestException/ForbiddenException/NewbieException/NotFoundException) must have a
 *    `recordLoginFailure`/`auditLogService.record` call within a few lines
 *    above it. A rejection that happens before any identity is resolved
 *    (e.g. an OAuth handshake returning no profile) is exempt, but only
 *    when the surrounding code says so explicitly via a comment containing
 *    "handshake" or "audit: not required" — silence is not an exemption.
 * 2. Success coverage — any file that mints a session directly via
 *    `sessionService.generate(` must also record `AuditEvent.LOGIN`.
 * 3. TOTP gate coverage — any file that mints a session directly must pass
 *    the account-level TOTP gate (`evaluateLoginMfaGate`, ADR-007) before
 *    generating it, so enabling TOTP protects every login channel, not just
 *    the ones routed through the shared AuthService.login().
 */

const AUTH_DIR = __dirname;

const LOGIN_ENTRY_FILES = [
  "auth.service.ts",
  "strategies/password.strategy.ts",
  "strategies/verification-code.strategy.ts",
  "strategies/google.strategy.ts",
  "lark/lark-auth.service.ts",
  "wechat/auth.service.ts",
  "login-by-approved-subnet.controller.ts",
  "strategies/refresh-token.strategy.ts",
];

const REJECTION_PATTERN =
  /throw new (UnauthorizedException|BadRequestException|ForbiddenException|NewbieException|NotFoundException)/;
const AUDIT_CALL_PATTERN = /recordLoginFailure\(|auditLogService\.record\(/;
const EXEMPTION_COMMENT_PATTERN = /handshake|audit: not required/i;
const LOOKBACK_LINES = 8;

const SUCCESS_SESSION_PATTERN = /sessionService\.generate\(/;
const SUCCESS_AUDIT_PATTERN = /AuditEvent\.LOGIN\b/;
const TOTP_GATE_PATTERN = /evaluateLoginMfaGate\(/;

function readLines(relativePath: string): string[] {
  return readFileSync(join(AUTH_DIR, relativePath), "utf8").split("\n");
}

function findUncoveredRejections(lines: string[]): number[] {
  const uncovered: number[] = [];
  lines.forEach((line, index) => {
    if (!REJECTION_PATTERN.test(line)) return;
    const windowStart = Math.max(0, index - LOOKBACK_LINES);
    const window = lines.slice(windowStart, index + 1).join("\n");
    if (AUDIT_CALL_PATTERN.test(window) || EXEMPTION_COMMENT_PATTERN.test(window)) return;
    uncovered.push(index + 1);
  });
  return uncovered;
}

describe("login audit coverage contract", () => {
  for (const relativePath of LOGIN_ENTRY_FILES) {
    it(`${relativePath}: every identity-resolved rejection is audited or explicitly exempt`, () => {
      const uncovered = findUncoveredRejections(readLines(relativePath));
      assert.deepEqual(
        uncovered,
        [],
        `${relativePath} rejects a login at line(s) ${uncovered.join(", ")} without a nearby ` +
          `recordLoginFailure/auditLogService.record call or an explicit "audit: not required"/"handshake" exemption comment.`,
      );
    });

    it(`${relativePath}: a directly-minted session is matched by a success audit record`, () => {
      const content = readLines(relativePath).join("\n");
      if (!SUCCESS_SESSION_PATTERN.test(content)) return;
      assert.ok(
        SUCCESS_AUDIT_PATTERN.test(content),
        `${relativePath} calls sessionService.generate() but never records AuditEvent.LOGIN.`,
      );
    });

    it(`${relativePath}: a directly-minted session passes the account-level TOTP gate`, () => {
      const content = readLines(relativePath).join("\n");
      if (!SUCCESS_SESSION_PATTERN.test(content)) return;
      assert.ok(
        TOTP_GATE_PATTERN.test(content),
        `${relativePath} mints a session via sessionService.generate() but never calls ` +
          `evaluateLoginMfaGate() — every session-minting login path must enforce the ` +
          `account-level TOTP gate before generating the session (see ADR-007).`,
      );
    });
  }
});
