/**
 * SPI port (dependency inversion): security owns the JWT verification
 * mechanics but must not know how/where sessions and users are stored.
 *
 * The identity provider module (e.g. account) implements this port against
 * its own tables and binds the implementation to {@link ACCESS_TOKEN_SESSION_RESOLVER}.
 */

export const ACCESS_TOKEN_SESSION_RESOLVER = Symbol("ACCESS_TOKEN_SESSION_RESOLVER");

export interface ResolvedAccessTokenSession {
  userId: string;
  sessionId: number;
  roles: string[];
}

export interface AccessTokenSessionResolver {
  /**
   * Resolve the live session named by the `sid` claim of a signature-verified
   * access token.
   *
   * Implementations MUST throw UnauthorizedException when the named session no
   * longer exists, and ForbiddenException when the owning identity is disabled.
   * Callers MUST reject a missing or non-integer id before calling this method:
   * an undefined id must never reach a query, where it would drop the id filter
   * and match an arbitrary row.
   */
  resolve(sessionId: number): Promise<ResolvedAccessTokenSession>;
}
