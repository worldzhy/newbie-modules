/**
 * Host-provided frontend-monitor visibility port.
 *
 * Sites live in Mongo keyed by appKey, but which apps a caller may see is a host
 * concept (project membership chained to the installation registry). The module
 * owns neither table, so the host supplies this port and **controllers** gate
 * every user-facing query on the returned keys. Services receive the resolved
 * keys as plain arguments and never see a user id or a project id.
 *
 * The host binds the port at assembly time; a missing binding fails at startup
 * rather than silently widening the scope. An empty array means "no apps".
 */
export const VISIBLE_APP_KEYS_RESOLVER = "VISIBLE_APP_KEYS_RESOLVER";

export interface VisibleAppKeysResolver {
  /**
   * appKeys of the frontend-monitor installations the caller may manage.
   * Revoked installations must not be included.
   */
  visibleAppKeys(userId: string): Promise<string[]>;
}
