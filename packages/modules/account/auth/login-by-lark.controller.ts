import { BadRequestException, Controller, Get, Ip, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiFoundResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { CookieName, CookieService } from "@modules/security/cookie/cookie.service";
import { LarkAuthService } from "@modules/account/auth/lark/lark-auth.service";

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

  @ApiFoundResponse({ description: "Redirect to the Feishu authorization page." })
  @NoGuard()
  @Get("login-by-lark")
  @ApiOperation({ summary: "Initiate Feishu OAuth login (redirects to Feishu)" })
  async signinWithLark(@Res() response: Response): Promise<void> {
    const state = randomUUID();
    const stateCookie = this.cookieService.generateForOAuthState(CookieName.LARK_OAUTH_STATE, state);
    response.cookie(stateCookie.name, stateCookie.value, stateCookie.options);
    response.redirect(this.larkAuthService.buildAuthorizeUrl(state));
  }

  @ApiFoundResponse({
    description:
      "Redirect to the frontend callback; the session token or MFA challenge travels in the URL hash fragment.",
  })
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
    const cookieState = request.cookies?.[CookieName.LARK_OAUTH_STATE];

    if (error) {
      throw new BadRequestException(`Feishu authorization denied: ${error}`);
    }
    if (!code || typeof queryState !== "string" || !cookieState || queryState !== cookieState) {
      throw new BadRequestException("Feishu OAuth state verification failed.");
    }

    // State verified — consume the single-use cookie so the handshake cannot
    // be replayed. A failed verification keeps the cookie intact.
    this.cookieService.clearOAuthState(CookieName.LARK_OAUTH_STATE, response);

    const userInfo = await this.larkAuthService.exchangeCodeForUserInfo(code);
    if (!userInfo) {
      throw new BadRequestException("Failed to fetch the Feishu user profile. Please try again.");
    }

    const loginResult = await this.larkAuthService.loginByLark({
      openId: userInfo.openId,
      unionId: userInfo.unionId,
      email: userInfo.email,
      phone: userInfo.phone,
      displayName: userInfo.name,
      avatarUrl: userInfo.avatarUrl,
      ipAddress,
      userAgent: request.headers["user-agent"] ?? "",
      response,
    });

    const frontendUrl = this.config.getOrThrow<string>("framework.app.frontendUrl");

    // A TOTP-enabled account receives the MFA challenge instead of a session;
    // the client completes login at /auth/login-by-totp via the dedicated page.
    if ("totpToken" in loginResult) {
      response.redirect(
        `${frontendUrl}/account/login/totp-callback#totpToken=${encodeURIComponent(loginResult.totpToken)}`,
      );
      return;
    }

    const hash = `#token=${encodeURIComponent(loginResult.token)}&expiresIn=${loginResult.tokenExpiresInSeconds}`;
    response.redirect(`${frontendUrl}/account/login/lark-callback${hash}`);
  }
}
