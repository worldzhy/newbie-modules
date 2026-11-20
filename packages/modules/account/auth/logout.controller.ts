import { Controller, Logger, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { Response } from "express";
import { Cookies } from "@devbie/newbie/decorators/cookie.decorator";
import { CookieName, CookieService } from "@modules/security/cookie/cookie.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { LogoutResponseDto } from "@modules/account/auth/auth.dto";

/**
 * Logout is anonymous-tolerant and idempotent: an expired access token must
 * not turn "sign out" into a 401, because that leaves the session alive and the
 * refresh cookie in the browser. The endpoint therefore opts out of the
 * authentication guard and revokes by the refresh token cookie instead — the
 * standard way to terminate a session when the access credential may already
 * be stale.
 */
@ApiTags("Account / Auth")
@Controller("auth")
export class LogoutController {
  private readonly logger = new Logger(LogoutController.name);

  constructor(
    private readonly cookieService: CookieService,
    private readonly sessionService: SessionService,
  ) {}

  @NoGuard()
  @Post("logout")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Logout the current user" })
  @ApiResponse({ type: LogoutResponseDto })
  async logout(
    @Cookies(CookieName.REFRESH_TOKEN) refreshToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: { message: string } }> {
    // [step 1] Revoke the session holding this refresh token. The browser may
    // still hold the previous generation when a rotation response was in flight
    // or was dropped, so the lookup falls back to it; otherwise that logout is a
    // silent no-op and the session outlives the click. Revocation stays
    // idempotent: an unknown or expired token is a no-op, so logout is
    // retry-safe and never discloses whether the token was valid.
    if (refreshToken) {
      const matched = await this.sessionService.revokeByRefreshToken(refreshToken, {
        allowPrevious: true,
        auditReason: "logout",
      });
      if (matched === "none") {
        // Expected for a stale or twice-rotated cookie; logged at debug so the
        // residual no-op rate is measurable without turning logout into noise.
        this.logger.debug("Logout presented a refresh token matching no session");
      }
    }

    // [step 2] Clear the cookie even when nothing was revoked, so a stale
    // credential cannot be replayed from the browser.
    this.cookieService.clear(response, CookieName.REFRESH_TOKEN);

    // [step 3] Always report success: logout has no failure mode the caller
    // can act on.
    return {
      data: { message: "User logs out successfully" },
    };
  }

  /* End */
}
