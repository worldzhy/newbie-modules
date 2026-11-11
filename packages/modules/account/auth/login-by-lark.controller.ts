import { BadRequestException, Controller, Get, Ip, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiFoundResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { CookieName, CookieService } from "@modules/security/cookie/cookie.service";
import { isSafeRedirectPath } from "@modules/security/cookie/redirect-path";
import { LarkAuthService } from "@modules/account/auth/lark/lark-auth.service";
import { PendingApprovalException } from "@modules/account/auth/auth.service";
import { isInactiveAccountError } from "@modules/account/auth/inactive-account";
import { LoginResult } from "@modules/account/account.interface";

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
  async signinWithLark(@Req() request: Request, @Res() response: Response): Promise<void> {
    const state = randomUUID();
    const stateCookie = this.cookieService.generateForOAuthState(CookieName.LARK_OAUTH_STATE, state);
    response.cookie(stateCookie.name, stateCookie.value, stateCookie.options);

    // Remember where the user was before being bounced to login so the callback
    // can send them back there. Only same-origin relative paths are stored;
    // a handshake started without one clears any stale destination left by an
    // earlier attempt.
    const redirectUrl = request.query.redirectUrl;
    if (isSafeRedirectPath(redirectUrl)) {
      const redirectCookie = this.cookieService.generateForOAuthRedirect(redirectUrl);
      response.cookie(redirectCookie.name, redirectCookie.value, redirectCookie.options);
    } else {
      this.cookieService.clearOAuthCookie(CookieName.OAUTH_REDIRECT_URL, response);
    }

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
    this.cookieService.clearOAuthCookie(CookieName.LARK_OAUTH_STATE, response);

    const userInfo = await this.larkAuthService.exchangeCodeForUserInfo(code);
    if (!userInfo) {
      throw new BadRequestException("Failed to fetch the Feishu user profile. Please try again.");
    }

    const frontendUrl = this.config.getOrThrow<string>("framework.app.frontendUrl");

    let loginResult: LoginResult;
    try {
      loginResult = await this.larkAuthService.loginByLark({
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
    } catch (error) {
      // A first-time Lark identity is provisioned as PENDING_APPROVAL and the
      // shared issuance exit refuses it. Send the browser back to the login
      // page with an approval notice instead of an error page.
      if (error instanceof PendingApprovalException) {
        response.redirect(`${frontendUrl}/account/login?pendingApproval=1`);
        return;
      }
      // A deactivated account is also a browser navigation: hand the user back
      // to the login page with a notice instead of rendering the 403 JSON.
      if (isInactiveAccountError(error)) {
        response.redirect(`${frontendUrl}/account/login?inactive=1`);
        return;
      }
      throw error;
    }

    // Mint the last-hop proof: it is stored as a readable cookie and echoed in
    // the redirect hash, so the frontend only adopts a session that was minted
    // in this browser (a callback URL replayed from elsewhere cannot match).
    const proof = randomUUID();
    const proofCookie = this.cookieService.generateForOAuthCallbackProof(proof);
    response.cookie(proofCookie.name, proofCookie.value, proofCookie.options);

    // The destination was stored when the handshake started; it is single-use.
    const redirectUrl = request.cookies?.[CookieName.OAUTH_REDIRECT_URL];
    this.cookieService.clearOAuthCookie(CookieName.OAUTH_REDIRECT_URL, response);

    // A TOTP-enabled account receives the MFA challenge instead of a session;
    // the client completes login at /auth/login-by-totp via the dedicated page.
    if ("totpToken" in loginResult) {
      const params = new URLSearchParams({ totpToken: loginResult.totpToken, proof });
      if (isSafeRedirectPath(redirectUrl)) params.set("redirectUrl", redirectUrl);
      response.redirect(`${frontendUrl}/account/login/totp-callback#${params.toString()}`);
      return;
    }

    const params = new URLSearchParams({
      token: loginResult.token,
      expiresIn: String(loginResult.tokenExpiresInSeconds),
      proof,
    });
    if (isSafeRedirectPath(redirectUrl)) params.set("redirectUrl", redirectUrl);
    response.redirect(`${frontendUrl}/account/login/lark-callback#${params.toString()}`);
  }
}
