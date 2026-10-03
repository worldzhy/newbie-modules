import { Body, Controller, Headers, Ip, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { TwoFactorService } from "../modules/two-factor/two-factor.service";
import { LimitLoginByIp } from "@modules/security/rate-limiter/rate-limiter.decorator";
import { NoGuard } from "@modules/security/passport/public/public.decorator";
import { LoginByPasswordResponseDto, TotpLoginDto } from "./auth.dto";
import { AuthService } from "./auth.service";

@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByTotpController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  /** Complete the password login with a TOTP code from the authenticator app. */
  @NoGuard()
  @LimitLoginByIp()
  @Post("login-by-totp")
  @ApiOperation({ summary: "Complete login with a TOTP code" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
  async loginByTotp(
    @Body() body: TotpLoginDto,
    @Ip() ipAddress: string,
    @Headers("User-Agent") userAgent: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginByPasswordResponseDto> {
    const userId = await this.twoFactorService.consumeMfaChallenge({ token: body.token, code: body.code });
    return await this.authService.login({ ipAddress, userAgent, userId, response });
  }
}
