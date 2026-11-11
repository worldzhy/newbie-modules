import { ForbiddenException } from "@nestjs/common";

/**
 * Single rejection message for a deactivated account.
 *
 * INACTIVE means an administrator disabled the account; a rejected
 * application is deleted instead (the IAM console rejects by deleting), so no
 * channel should report it as a pending state. Every channel throws this same
 * 403 body so the client sees one contract regardless of login method.
 */
export const INACTIVE_ACCOUNT_MESSAGE = "The account is not active.";

/**
 * Whether an error is the shared inactive-account rejection.
 *
 * Browser-navigation channels (the OAuth callbacks) must turn this into a
 * redirect back to the login page: a thrown exception would make the browser
 * render the raw 403 envelope as a blank page instead of an actionable notice.
 */
export function isInactiveAccountError(error: unknown): boolean {
  return error instanceof ForbiddenException && error.message === INACTIVE_ACCOUNT_MESSAGE;
}
