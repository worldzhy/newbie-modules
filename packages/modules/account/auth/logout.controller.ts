import { Controller, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { CookieName, CookieService } from "@modules/security/cookie/cookie.service";
import { LimitLoginByUserService } from "@modules/security/rate-limiter/rate-limiter.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";
import { AccessTokenParsed, UserRequest } from "@modules/security/security.interface";
import { LogoutResponseDto } from "@modules/account/auth/auth.dto";

// Logout is anonymous-tolerant: the guard populates `user` only when the
// request carries a credential, so the identity is optional here while every
// other handler may rely on the guard having resolved it.
interface LogoutRequest extends Omit<UserRequest, "user"> {
  user?: AccessTokenParsed;
}

@ApiTags("Account / Auth")
@Controller("auth")
export class LogoutController {
  constructor(
    private readonly cookieService: CookieService,
    private readonly limitLoginByUserService: LimitLoginByUserService,
    private readonly sessionService: SessionService,
  ) {}

  @Post("logout")
  @RequireOwner()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Logout the current user" })
  @ApiResponse({ type: LogoutResponseDto })
  async logout(
    @Req() req: LogoutRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: { message: string } }> {
    // [step 1] The guard already resolved this request's session, so revoke by
    // the resolved id instead of re-parsing the token (devbie ADR-051). An
    // anonymous request has no session to revoke and no attempts to clear.
    const user = req.user;
    if (user) {
      // The JWT strategy always resolves a session id; a credential strategy
      // that carries none has no row to revoke, and the call is idempotent
      // either way.
      if (user.sessionId !== undefined) {
        await this.sessionService.revokeSession(user.sessionId);
      }
      await this.limitLoginByUserService.delete(user.userId);
    }

    // [step 2] Clear cookie
    this.cookieService.clear(response, CookieName.REFRESH_TOKEN);

    // [step 3] Always return success no matter if the user exists.
    return {
      data: { message: "User logs out successfully" },
    };
  }

  /* End */
}
