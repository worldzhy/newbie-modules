import { NewbieException, NewbieExceptionType, newbieExceptionCode } from "@devbie/newbie/exceptions/newbie.exception";

/**
 * The single account-state rejection for a disabled account.
 *
 * INACTIVE means an administrator disabled the account; a rejected application
 * is deleted instead (the IAM console rejects by deleting), so no channel
 * should report it as a pending state. Every channel throws this same coded
 * 403 so the client sees one contract regardless of login method, and can tell
 * it apart from a closed account (`Account_Closed`) that the owner may recover.
 */
export function inactiveAccountError(): NewbieException {
  return new NewbieException(NewbieExceptionType.Account_Disabled);
}

/**
 * Whether an error is an account-state rejection (closed or disabled).
 *
 * Browser-navigation channels (the OAuth callbacks) must turn this into a
 * redirect back to the login page: a thrown exception would make the browser
 * render the raw 403 envelope as a blank page instead of an actionable notice.
 */
export function isInactiveAccountError(error: unknown): boolean {
  if (!(error instanceof NewbieException)) return false;
  const { code } = error.getResponse() as { code?: number };
  return (
    code === newbieExceptionCode(NewbieExceptionType.Account_Closed) ||
    code === newbieExceptionCode(NewbieExceptionType.Account_Disabled)
  );
}
