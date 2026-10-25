import { Controller, Get, Ip, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { GuardByGoogle } from "@modules/security/authentication/google-oauth/google.decorator";
import { GoogleUserResDto } from "@modules/security/authentication/google-oauth/dto/google-user.dto";
import { AuthService } from "@modules/account/auth/auth.service";
import { LoginByPasswordResponseDto } from "@modules/account/auth/auth.dto";

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
  ) {}

  @ApiOkResponse()
  @GuardByGoogle()
  @Get("login-by-google")
  @ApiOperation({ summary: "Initiate Google OAuth login (redirects to Google)" })
  async signinWithGoogle(): Promise<void> {
    // GoogleAuthGuard performs the redirect; the body is intentionally empty.
  }

  @GuardByGoogle()
  @Get("login-by-google/redirect")
  @ApiOperation({ summary: "Google OAuth redirect callback" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
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

    // A TOTP-enabled account receives the MFA challenge instead of a session;
    // the client completes login at /auth/login-by-totp via the dedicated page.
    if ("totpToken" in loginResult) {
      response.redirect(
        `${frontendUrl}/account/login/totp-callback#totpToken=${encodeURIComponent(loginResult.totpToken)}`,
      );
      return;
    }

    // Redirect to the frontend landing page; the token travels in the URL hash
    // fragment, which browsers never send to servers and never write to logs.
    const hash = `#token=${encodeURIComponent(loginResult.token)}&expiresIn=${loginResult.tokenExpiresInSeconds}`;
    response.redirect(`${frontendUrl}/account/login/google-callback${hash}`);
  }
}
