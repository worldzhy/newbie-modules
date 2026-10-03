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

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, "custom.refresh-token") {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
  ) {
    super();
  }

  /**
   * 'validate' function must be implemented.
   */
  async validate(req: Request): Promise<boolean> {
    // [step 0] Extract refresh token from cookie or body
    const refreshToken: string = req.cookies[CookieName.REFRESH_TOKEN] || req.body[CookieName.REFRESH_TOKEN];

    // [step 1] Check if refresh token is provided
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
      // (signature check fails) is simply rejected.
      let userId: string | undefined;
      try {
        userId = this.tokenService.verifyUserRefreshToken(refreshToken).userId;
      } catch {
        throw new UnauthorizedException("Token is incorrect.");
      }
      await this.prisma.session.deleteMany({ where: { userId } });
      throw new UnauthorizedException("Refresh token reuse detected; all sessions have been revoked.");
    }

    // [step 3] Validate refresh token expiry.
    try {
      this.tokenService.verifyUserRefreshToken(refreshToken);
    } catch (error: unknown) {
      await this.sessionService.destroy(refreshToken);
      throw new UnauthorizedException("Token is expired.");
    }

    // [step 4] The account must still be active.
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException("The account is not active.");
    }

    return true;
  }
}
