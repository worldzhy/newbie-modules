import { Controller, Get, Ip, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { GuardByGoogle } from "@modules/account/security/passport/google-oauth/google.decorator";
import { GoogleUserResDto } from "@modules/account/security/passport/google-oauth/dto/google-user.dto";
import { AuthService } from "@modules/account/auth/auth.service";
import { GoogleOAuthRedirectResponseDto } from "@modules/account/auth/auth.dto";

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
  constructor(private readonly authService: AuthService) {}

  @GuardByGoogle()
  @Get("login-by-google")
  @ApiOperation({ summary: "Initiate Google OAuth login (redirects to Google)" })
  async signinWithGoogle(): Promise<void> {
    // GoogleAuthGuard performs the redirect; the body is intentionally empty.
  }

  @GuardByGoogle()
  @Get("login-by-google/redirect")
  @ApiOperation({ summary: "Google OAuth redirect callback" })
  @ApiResponse({ type: GoogleOAuthRedirectResponseDto })
  async googleOAuthredirect(
    @Req() request: Request & { user: GoogleUserResDto },
    @Res({ passthrough: true }) response: Response,
    @Ip() ipAddress: string,
  ): Promise<GoogleOAuthRedirectResponseDto> {
    // The Google profile alone is not a session: issue platform tokens and the
    // refresh-token cookie through the shared login path.
    return await this.authService.loginByGoogle({
      email: request.user.email,
      displayName: request.user.displayName,
      ipAddress,
      userAgent: request.headers["user-agent"] ?? "",
      response,
    });
  }
}
