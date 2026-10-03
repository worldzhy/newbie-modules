import { Body, Controller, Headers, Ip, Post, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { MfaMethod } from "@generated/prisma/client";
import { Response } from "express";
import { AuthService } from "@modules/account/auth/auth.service";
import { TwoFactorService } from "@modules/account/modules/two-factor/two-factor.service";
import { GuardByPassword } from "@modules/security/passport/password/password.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { LimitLoginByIp, LimitLoginByUser } from "@modules/security/rate-limiter/rate-limiter.decorator";
import { LimitLoginByIpService } from "@modules/security/rate-limiter/rate-limiter.service";
import { LoginByPasswordRequestDto, LoginByPasswordResponseDto } from "@modules/account/auth/auth.dto";

@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByPasswordController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
    private readonly limitLoginByIpService: LimitLoginByIpService,
  ) {}

  /**
   * After a user is verified by auth guard, this 'login' function returns
   * a JWT to declare the user is authenticated.
   *
   * The 'account' parameter supports:
   * [1] email
   * [2] phone
   *
   * When the account has TOTP enabled, an MFA challenge is returned instead;
   * the client completes login at /auth/login-by-totp.
   */
  @Post("login-by-password")
  @LimitLoginByIp()
  @LimitLoginByUser()
  @GuardByPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Login with account and password" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
  async loginByPassword(
    @Body() body: LoginByPasswordRequestDto, // Is it required for guard?
    @Ip() ipAddress: string,
    @Headers("User-Agent") userAgent: string,
    @Req() request: UserRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginByPasswordResponseDto> {
    // MFA challenge: the password was valid, but the second factor is still
    // missing. Neither the IP nor the per-user rate limit is reset — login is
    // not complete until the TOTP step succeeds.
    if (await this.twoFactorService.isTotpEnabled(request.user.userId)) {
      return {
        totpToken: this.twoFactorService.issueMfaToken(request.user.userId),
        type: MfaMethod.TOTP,
        multiFactorRequired: true,
      } as LoginByPasswordResponseDto;
    }

    const loginResult = await this.authService.login({
      ipAddress,
      userAgent,
      userId: request.user.userId,
      response,
    });

    // Reset the per-IP login rate limit counted by the rate limiter guard.
    await this.limitLoginByIpService.delete(ipAddress);

    return loginResult;
  }

  /* End */
}
