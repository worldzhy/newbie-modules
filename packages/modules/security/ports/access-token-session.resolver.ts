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
   * Resolve a signature-verified access token to its live session.
   *
   * Implementations MUST throw UnauthorizedException when no live session
   * holds the token, and ForbiddenException when the owning identity is
   * disabled.
   */
  resolve(accessToken: string): Promise<ResolvedAccessTokenSession>;
}
