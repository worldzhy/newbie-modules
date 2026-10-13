import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-custom";
import { Request } from "express";
import { UserStatus } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { NO_TOKEN_PROVIDED } from "@devbie/newbie/exceptions/errors.constants";
import { SessionService } from "@modules/account/modules/session/session.service";
import { TokenService } from "@modules/security/token/token.service";
import { CookieName } from "@modules/security/cookie/cookie.service";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "@modules/account/auth/login-audit";

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, "custom.refresh-token") {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {
    super();
  }

  /**
   * 'validate' function must be implemented.
   */
  async validate(req: Request): Promise<boolean> {
    // [step 0] Extract refresh token from cookie or body
    const refreshToken: string =
      req.cookies?.[CookieName.REFRESH_TOKEN] || req.body?.[CookieName.REFRESH_TOKEN];

    // [step 1] Check if refresh token is provided. No token at all means no
    // identity to attribute a failure to — audit: not required (handshake).
    if (!refreshToken) {
      throw new UnauthorizedException(NO_TOKEN_PROVIDED);
    }

    // [step 2] Look up the live session holding this token.
    const session = await this.prisma.session.findFirst({
      where: { refreshToken },
      select: { id: true, userId: true, user: { select: { status: true } } },
    });

    if (!session) {
      // No live session holds the token. If its signature is genuine, it was
      // already rotated by a refresh or revoked by logout: reuse indicates a
      // leaked token, so revoke every session of the owner. A forged token
      // (signature check fails) is simply rejected — audit: not required
      // (handshake), no identity can be resolved from an invalid signature.
      let userId: string | undefined;
      try {
        userId = this.tokenService.verifyUserRefreshToken(refreshToken).userId;
      } catch {
        throw new UnauthorizedException("Token is incorrect.");
      }
      const { count } = await this.prisma.session.deleteMany({ where: { userId } });
      await this.auditLogService.record(AuditEvent.SESSION_REVOKED, {
        actorType: AuditActorType.USER,
        actorId: userId,
        resourceType: "session",
        detail: { reason: "refresh_token_reuse", revokedSessionCount: count },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      throw new UnauthorizedException("Refresh token reuse detected; all sessions have been revoked.");
    }

    // [step 3] Validate refresh token expiry. Expired refresh is routine
    // session housekeeping (every live session eventually hits this), not a
    // rejected login attempt, so it is intentionally not audited.
    // audit: not required — routine expiry noise
    try {
      this.tokenService.verifyUserRefreshToken(refreshToken);
    } catch (error: unknown) {
      await this.sessionService.destroy(refreshToken);
      throw new UnauthorizedException("Token is expired.");
    }

    // [step 4] The account must still be active. Unlike expiry, a disabled
    // account still presenting a live refresh token is a security-relevant
    // signal (e.g. a leaked token outliving the deactivation), so it is
    // audited like every other inactive-account rejection in this module.
    if (session.user.status !== UserStatus.ACTIVE) {
      await recordLoginFailure(this.auditLogService, {
        actorId: session.userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        detail: { reason: "inactive_user", provider: "refresh_token" },
      });
      throw new ForbiddenException("The account is not active.");
    }

    return true;
  }
}
