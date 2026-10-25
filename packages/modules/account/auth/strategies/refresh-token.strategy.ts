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
import { AuditLogService } from "@modules/audit/audit-log.service";
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
   * Authenticate the refresh token and check the account is still active.
   * Rotation, idempotent replay, and reuse revocation live in
   * SessionService.refresh (ADR-034); this guard only proves the token is a
   * genuine, unexpired credential for an active account.
   */
  async validate(req: Request): Promise<boolean> {
    // [step 0] Extract refresh token from cookie or body.
    const refreshToken: string = req.cookies?.[CookieName.REFRESH_TOKEN] || req.body?.[CookieName.REFRESH_TOKEN];

    // [step 1] No token at all means no identity to attribute a failure to —
    // audit: not required (handshake).
    if (!refreshToken) {
      throw new UnauthorizedException(NO_TOKEN_PROVIDED);
    }

    // [step 2] Verify signature and expiry. Expired refresh is routine session
    // housekeeping (every live session eventually hits this), not a rejected
    // login attempt, so it is intentionally not audited. The matching session
    // is destroyed by hash so it does not linger.
    let userId: string;
    try {
      userId = this.tokenService.verifyUserRefreshToken(refreshToken).userId;
    } catch {
      await this.sessionService.destroy(refreshToken);
      // audit: not required — routine expiry or a forged token; no identity
      // can be reliably attributed to a failed signature check.
      throw new UnauthorizedException("Token is incorrect or expired.");
    }

    // [step 3] The account must still be active. Unlike expiry, a disabled
    // account still presenting a live refresh token is a security-relevant
    // signal (e.g. a leaked token outliving the deactivation), so it is
    // audited like every other inactive-account rejection in this module.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      await recordLoginFailure(this.auditLogService, {
        actorId: userId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        detail: { reason: "inactive_user", provider: "refresh_token" },
      });
      throw new ForbiddenException("The account is not active.");
    }

    return true;
  }
}
