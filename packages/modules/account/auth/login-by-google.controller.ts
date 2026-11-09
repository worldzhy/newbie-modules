import { Controller, Get, Ip, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiFoundResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { GuardByGoogle } from "@modules/security/authentication/google-oauth/google.decorator";
import { GoogleUserResDto } from "@modules/security/authentication/google-oauth/dto/google-user.dto";
import { CookieName, CookieService } from "@modules/security/cookie/cookie.service";
import { isSafeRedirectPath } from "@modules/security/cookie/redirect-path";
import { AuthService } from "@modules/account/auth/auth.service";

/**
 * Google OAuth login endpoints.
 *
 * The handshake spans two requests:
 *   1. GET /auth/login-by-google
 *      GoogleAuthGuard sets a state cookie and redirects the browser to Google.
 *   2. GET /auth/login-by-google/redirect?code=...&state=...
 *      The guard verifies the state, Passport exchanges the code for the
 *      Google profile, and AuthService issues the platform session.
 */
@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByGoogleController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly cookieService: CookieService,
  ) {}

  @ApiFoundResponse({ description: "Redirect to the Google authorization page." })
  @GuardByGoogle()
  @Get("login-by-google")
  @ApiOperation({ summary: "Initiate Google OAuth login (redirects to Google)" })
  async signinWithGoogle(): Promise<void> {
    // GoogleAuthGuard performs the redirect; the body is intentionally empty.
  }

  @GuardByGoogle()
  @Get("login-by-google/redirect")
  @ApiOperation({ summary: "Google OAuth redirect callback" })
  @ApiFoundResponse({
    description:
      "Redirect to the frontend callback; the session token or MFA challenge travels in the URL hash fragment.",
  })
  async googleOAuthredirect(
    @Req() request: Request & { user: GoogleUserResDto },
    @Res() response: Response,
    @Ip() ipAddress: string,
  ): Promise<void> {
    const loginResult = await this.authService.loginByGoogle({
      email: request.user.email,
      displayName: request.user.displayName,
      ipAddress,
      userAgent: request.headers["user-agent"] ?? "",
      response,
    });

    const frontendUrl = this.config.getOrThrow<string>("framework.app.frontendUrl");

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

    // Redirect to the frontend landing page; the token travels in the URL hash
    // fragment, which browsers never send to servers and never write to logs.
    const params = new URLSearchParams({
      token: loginResult.token,
      expiresIn: String(loginResult.tokenExpiresInSeconds),
      proof,
    });
    if (isSafeRedirectPath(redirectUrl)) params.set("redirectUrl", redirectUrl);
    response.redirect(`${frontendUrl}/account/login/google-callback#${params.toString()}`);
  }
}
