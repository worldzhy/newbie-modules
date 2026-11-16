import { Controller, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { Response } from "express";
import { Cookies } from "@devbie/newbie/decorators/cookie.decorator";
import { CookieName } from "@modules/security/cookie/cookie.service";
import { GuardByRefreshToken } from "@modules/security/authentication/refresh-token/refresh-token.decorator";
import { AuthService } from "@modules/account/auth/auth.service";
import { LoginByPasswordResponseDto } from "@modules/account/auth/auth.dto";

@ApiTags("Account / Auth")
@Controller("auth")
export class RefreshSessionController {
  constructor(private readonly authService: AuthService) {}

  @GuardByRefreshToken()
  @Post("refresh-session")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Refresh the session using the refresh token cookie" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
  async refresh(
    @Cookies(CookieName.REFRESH_TOKEN) refreshToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.authService.refreshAccessToken({ refreshToken, response });
  }

  /* End */
}
