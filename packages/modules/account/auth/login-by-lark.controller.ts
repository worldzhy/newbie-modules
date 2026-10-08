import { BadRequestException, Controller, Get, Ip, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { CookieService } from "@modules/security/cookie/cookie.service";
import { LarkAuthService } from "@modules/account/auth/lark/lark-auth.service";

const LARK_OAUTH_STATE_COOKIE = "larkOAuthState";
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Feishu/Lark OAuth login endpoints.
 *
 * The handshake spans two requests:
 *   1. GET /auth/login-by-lark
 *      Mint a random state, store it in a short-lived cookie, and redirect the
 *      browser to the Feishu authorization page.
 *   2. GET /auth/login-by-lark/redirect?code=...&state=...
 *      Verify the state against the cookie, exchange the code for the user
 *      profile, issue the platform session, and redirect to the frontend
 *      callback with the access token in the URL hash fragment.
 */
@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByLarkController {
  constructor(
    private readonly larkAuthService: LarkAuthService,
    private readonly config: ConfigService,
    private readonly cookieService: CookieService,
  ) {}

  @NoGuard()
  @Get("login-by-lark")
  @ApiOperation({ summary: "Initiate Feishu OAuth login (redirects to Feishu)" })
  async signinWithLark(@Res() response: Response): Promise<void> {
    const state = randomUUID();
    response.cookie(LARK_OAUTH_STATE_COOKIE, state, {
      ...this.cookieService.defaultCookieOptions(),
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
    });
    response.redirect(this.larkAuthService.buildAuthorizeUrl(state));
  }

  @NoGuard()
  @Get("login-by-lark/redirect")
  @ApiOperation({ summary: "Feishu OAuth redirect callback" })
  async larkOAuthRedirect(
    @Req() request: Request,
    @Res() response: Response,
    @Ip() ipAddress: string,
    @Query("code") code?: string,
    @Query("state") queryState?: string,
    @Query("error") error?: string,
  ): Promise<void> {
    const cookieState = request.cookies?.[LARK_OAUTH_STATE_COOKIE];
    response.cookie(LARK_OAUTH_STATE_COOKIE, "", {
      ...this.cookieService.defaultCookieOptions(),
      sameSite: "lax",
      maxAge: 0,
    });

    if (error) {
      throw new BadRequestException(`Feishu authorization denied: ${error}`);
    }
    if (!code || typeof queryState !== "string" || !cookieState || queryState !== cookieState) {
      throw new BadRequestException("Feishu OAuth state verification failed.");
    }

    const userInfo = await this.larkAuthService.exchangeCodeForUserInfo(code);
    if (!userInfo) {
      throw new BadRequestException("Failed to fetch the Feishu user profile. Please try again.");
    }

    const { token, tokenExpiresInSeconds } = await this.larkAuthService.loginByLark({
      openId: userInfo.openId,
      unionId: userInfo.unionId,
      email: userInfo.email,
      displayName: userInfo.name,
      avatarUrl: userInfo.avatarUrl,
      ipAddress,
      userAgent: request.headers["user-agent"] ?? "",
      response,
    });

    const frontendUrl = this.config.getOrThrow<string>("framework.app.frontendUrl");
    const hash = `#token=${encodeURIComponent(token)}&expiresIn=${tokenExpiresInSeconds}`;
    response.redirect(`${frontendUrl}/account/login/lark-callback${hash}`);
  }
}
