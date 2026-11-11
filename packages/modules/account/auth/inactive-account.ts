/**
 * Single rejection message for a deactivated account.
 *
 * INACTIVE means an administrator disabled the account; a rejected
 * application is deleted instead (the IAM console rejects by deleting), so no
 * channel should report it as a pending state. Every channel throws this same
 * 403 body so the client sees one contract regardless of login method.
 */
export const INACTIVE_ACCOUNT_MESSAGE = "The account is not active.";
