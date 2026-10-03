/**
 * SPI port for translating a login identifier (email address or phone
 * number) to the identity's internal id. Used by the per-user login rate
 * limiter, which must share one bucket across all aliases of one identity.
 */

export const LOGIN_ACCOUNT_RESOLVER = Symbol("LOGIN_ACCOUNT_RESOLVER");

export interface LoginAccountResolver {
  findAccountId(account: string): Promise<string | null>;
}
