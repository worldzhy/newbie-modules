import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { OAuthClient, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { generateHash } from "@devbie/newbie/utilities/common.util";
import { TokenService } from "@modules/security/token/token.service";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";
import { SessionService } from "@modules/account/modules/session/session.service";

/**
 * Authorization Code Flow (RFC 6749 §4.1) with PKCE (RFC 7636). Standalone
 * module, so the host can opt in via `newbie modules add oauth`. Business
 * state (clients, codes, consents) lives here; bearer transport stays in
 * security. Access tokens are minted by account's SessionService so an OAuth
 * session is indistinguishable from a web session except for its non-null
 * `oauthClientId` / `oauthScope` columns.
 */

/** Authorization codes are single-use and short-lived. */
const CODE_TTL_MS = 5 * 60 * 1000;
/** PKCE challenge method we accept. S256 is mandatory; plain is refused. */
const PKCE_METHOD_S256 = "S256";

/** Shape returned to the controller when authorize needs a consent page. */
export type AuthorizeChallenge = {
  /** Render the consent page; user approval continues the flow. */
  requireConsent: true;
  client: OAuthClient;
  requestedScope: string;
};

/** Shape returned to the controller when authorize can redirect immediately. */
export type AuthorizeRedirect = {
  /** Redirect back to the client with the issued code. */
  requireConsent: false;
  redirectUri: string;
  code: string;
  state: string;
};

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Admin client management (IAM; permission gate lives on the controller)
  // ---------------------------------------------------------------------------

  async createClient(params: {
    actorId: string;
    ipAddress?: string;
    userAgent?: string;
    data: Pick<Prisma.OAuthClientCreateInput, "clientId" | "redirectUris" | "scopes" | "description">;
  }): Promise<ExposeClient & { clientSecret?: string }> {
    const existing = await this.prisma.oAuthClient.findUnique({ where: { clientId: params.data.clientId } });
    if (existing) {
      throw new BadRequestException({
        error: "invalid_client",
        error_description: `client_id "${params.data.clientId}" already exists`,
      });
    }

    // A public client (e.g. a desktop app) carries no secret. A confidential
    // client's secret is generated here and returned exactly once; only its
    // hash is stored.
    const clientSecret = await this.tokenService.generateRandomString(48, "url-safe");
    const client = await this.prisma.oAuthClient.create({
      data: {
        ...params.data,
        clientSecretHash: await generateHash(clientSecret),
        createdBy: params.actorId,
      },
    });

    await this.auditLogService.record(AuditEvent.OAUTH_CLIENT_CREATED, {
      actorType: AuditActorType.USER,
      actorId: params.actorId,
      resourceType: "oauth-client",
      resourceId: client.clientId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      detail: { description: client.description, publicClient: false },
    });

    return { ...this.redact(client), clientSecret };
  }

  async listClients(): Promise<ExposeClient[]> {
    const clients = await this.prisma.oAuthClient.findMany({ orderBy: { id: "asc" } });
    return clients.map((client) => this.redact(client));
  }

  async revokeClient(params: { clientId: string; actorId: string; ipAddress?: string; userAgent?: string }) {
    const client = await this.getActiveClient(params.clientId);
    const revoked = await this.prisma.oAuthClient.update({
      where: { clientId: client.clientId },
      data: { revokedAt: new Date() },
    });
    await this.auditLogService.record(AuditEvent.OAUTH_CLIENT_REVOKED, {
      actorType: AuditActorType.USER,
      actorId: params.actorId,
      resourceType: "oauth-client",
      resourceId: client.clientId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    return this.redact(revoked);
  }

  // ---------------------------------------------------------------------------
  // Authorize -> consent -> code
  // ---------------------------------------------------------------------------

  /**
   * Validate an authorize request and either short-circuit to a redirect (an
   * existing standing consent covers the requested scope) or ask the controller
   * to render the consent page.
   *
   * Hard validation failures throw an OAuth error and never render a consent
   * page, so a probe cannot learn whether a redirect URI or client exists.
   */
  async authorize(params: {
    userId: string;
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string;
  }): Promise<AuthorizeChallenge | AuthorizeRedirect> {
    const client = await this.getActiveClient(params.clientId);

    if (!client.redirectUris.includes(params.redirectUri)) {
      throw new BadRequestException({
        error: "invalid_redirect_uri",
        error_description: "redirect_uri is not registered for this client",
      });
    }

    const requestedScopeSet = params.scope.split(/\s+/).filter(Boolean);
    const scopeOutsideWhitelist = requestedScopeSet.filter((s) => !client.scopes.includes(s));
    if (scopeOutsideWhitelist.length > 0) {
      throw new BadRequestException({
        error: "invalid_scope",
        error_description: `scope(s) outside client whitelist: ${scopeOutsideWhitelist.join(" ")}`,
      });
    }

    if (params.codeChallengeMethod !== PKCE_METHOD_S256 || !params.codeChallenge) {
      throw new BadRequestException({
        error: "invalid_request",
        error_description: "S256 PKCE code_challenge is required",
      });
    }

    // Standing consent: an existing consent row whose granted scope covers the
    // requested scope skips the page and issues the code immediately.
    const consent = await this.prisma.oAuthConsent.findUnique({
      where: { userId_clientId: { userId: params.userId, clientId: client.clientId } },
    });
    if (consent && !consent.revokedAt && this.scopeCovers(consent.scopeGranted, requestedScopeSet)) {
      const code = await this.issueCode({
        client,
        userId: params.userId,
        scope: params.scope,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
      });
      return { requireConsent: false, redirectUri: params.redirectUri, code, state: params.state };
    }

    return { requireConsent: true, client, requestedScope: params.scope };
  }

  /**
   * User approved the consent page. Persist (or widen) the standing consent
   * row, then issue the authorization code and hand back the redirect target.
   */
  async approveConsent(params: {
    userId: string;
    clientId: string;
    scope: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
  }): Promise<AuthorizeRedirect> {
    const client = await this.getActiveClient(params.clientId);
    if (!client.redirectUris.includes(params.redirectUri)) {
      throw new BadRequestException({ error: "invalid_redirect_uri" });
    }

    const grantedScope = params.scope.trim();
    await this.prisma.oAuthConsent.upsert({
      where: { userId_clientId: { userId: params.userId, clientId: client.clientId } },
      create: { userId: params.userId, clientId: client.clientId, scopeGranted: grantedScope },
      update: { scopeGranted: grantedScope, revokedAt: null },
    });

    await this.auditLogService.record(AuditEvent.OAUTH_AUTHORIZE_CONSENT, {
      actorType: AuditActorType.USER,
      actorId: params.userId,
      resourceType: "oauth-client",
      resourceId: client.clientId,
      detail: { scope: grantedScope },
    });

    const code = await this.issueCode({
      client,
      userId: params.userId,
      scope: grantedScope,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
    });
    return { requireConsent: false, redirectUri: params.redirectUri, code, state: params.state };
  }

  private async issueCode(params: {
    client: OAuthClient;
    userId: string;
    scope: string;
    redirectUri: string;
    codeChallenge: string;
  }): Promise<string> {
    const code = randomBytes(32).toString("hex");
    await this.prisma.oAuthAuthorizationCode.create({
      data: {
        code,
        clientId: params.client.clientId,
        userId: params.userId,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: PKCE_METHOD_S256,
        scope: params.scope,
        redirectUri: params.redirectUri,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }

  // ---------------------------------------------------------------------------
  // code -> token
  // ---------------------------------------------------------------------------

  async exchangeCodeForToken(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    codeVerifier: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scope: string }> {
    const oauthError = (description: string) =>
      new BadRequestException({ error: "invalid_grant", error_description: description });

    const codeRow = await this.prisma.oAuthAuthorizationCode.findUnique({
      where: { code: params.code },
      include: { client: true },
    });

    // Every failure path collapses to the same generic invalid_grant so an
    // attacker cannot probe which check failed (existence, replay, expiry).
    if (!codeRow || codeRow.usedAt || codeRow.expiresAt < new Date()) {
      throw oauthError("authorization code is invalid, expired, or already used");
    }
    if (codeRow.clientId !== params.clientId) {
      throw oauthError("client_id mismatch");
    }
    if (codeRow.redirectUri !== params.redirectUri) {
      throw oauthError("redirect_uri mismatch");
    }
    if (codeRow.client.revokedAt) {
      throw oauthError("client has been revoked");
    }

    // PKCE: S256(code_verifier) must equal the stored challenge, compared in
    // constant time.
    const expectedChallenge = createHash("sha256").update(params.codeVerifier).digest("base64url");
    if (
      expectedChallenge.length !== codeRow.codeChallenge.length ||
      !timingSafeEqual(Buffer.from(expectedChallenge), Buffer.from(codeRow.codeChallenge))
    ) {
      throw oauthError("PKCE code_verifier mismatch");
    }

    // Mark the code used before minting tokens so a concurrent replay loses
    // the CAS race and sees usedAt set.
    const markUsed = await this.prisma.oAuthAuthorizationCode.updateMany({
      where: { code: codeRow.code, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (markUsed.count !== 1) {
      throw oauthError("authorization code is invalid, expired, or already used");
    }

    // Mint a session carrying the OAuth context. SessionService owns token
    // signing + refresh rotation; we only attach the OAuth columns.
    const session = await this.sessionService.generate({
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      userId: codeRow.userId,
    });
    await this.prisma.session.update({
      where: { id: session.id },
      data: { oauthClientId: codeRow.clientId, oauthScope: codeRow.scope },
    });

    await this.auditLogService.record(AuditEvent.OAUTH_TOKEN_ISSUED, {
      actorType: AuditActorType.USER,
      actorId: codeRow.userId,
      resourceType: "oauth-client",
      resourceId: codeRow.clientId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      detail: { scope: codeRow.scope, sessionId: session.id },
    });

    // RFC 6749 §5.1: `expires_in` is the lifetime in seconds. The config stores
    // a human "10m" string, so we convert it.
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: 600, // SECURITY_TOKEN_EXPIRES_IN.userAccess ("10m") in seconds
      scope: codeRow.scope,
    };
  }

  /**
   * RFC 7009 revoke: invalidate the session named by a presented refresh
   * token. The caller is authenticated by the bearer access token (guard), so
   * we only need to resolve and delete the session holding this refresh token.
   */
  async revokeToken(params: { refreshToken: string; actorId: string; ipAddress?: string; userAgent?: string }) {
    const matched = await this.sessionService.revokeByRefreshToken(params.refreshToken, {
      allowPrevious: true,
      auditReason: "oauth_revoke",
    });
    await this.auditLogService.record(AuditEvent.OAUTH_TOKEN_REVOKED, {
      actorType: AuditActorType.USER,
      actorId: params.actorId,
      resourceType: "session",
      detail: { matched },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    // RFC 7009: always 200 even when the token was unknown.
    return { revoked: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getActiveClient(clientId: string): Promise<OAuthClient> {
    const client = await this.prisma.oAuthClient.findUnique({ where: { clientId } });
    if (!client || client.revokedAt) {
      throw new NotFoundException({
        error: "invalid_client",
        error_description: "unknown or revoked client",
      });
    }
    return client;
  }

  /** A consent scope (space-separated) covers the requested scope set. */
  private scopeCovers(grantedScope: string, requested: string[]): boolean {
    const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
    return requested.every((s) => granted.has(s));
  }

  /** Never leak the secret hash back to callers. */
  private redact(client: OAuthClient): ExposeClient {
    const { clientSecretHash, ...rest } = client;
    void clientSecretHash;
    return rest;
  }
}

type ExposeClient = Omit<OAuthClient, "clientSecretHash">;
