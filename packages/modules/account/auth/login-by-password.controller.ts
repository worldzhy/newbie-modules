import { Body, Controller, Headers, Ip, Post, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AuthService } from "@modules/account/auth/auth.service";
import { GuardByPassword } from "@modules/security/authentication/password/password.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { LimitLoginByIp, LimitLoginByUser } from "@modules/security/rate-limiter/rate-limiter.decorator";
import { LimitLoginByIpService } from "@modules/security/rate-limiter/rate-limiter.service";
import { LoginByPasswordRequestDto, LoginByPasswordResponseDto } from "@modules/account/auth/auth.dto";

@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByPasswordController {
  constructor(
    private readonly authService: AuthService,
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
   * When the account has TOTP enabled, the shared login() returns an MFA
   * challenge instead of a session; the client completes login at
   * /auth/login-by-totp.
   */
  @Post("login-by-password")
  @LimitLoginByIp()
  @LimitLoginByUser()
  @GuardByPassword()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Login with account and password" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
  async loginByPassword(
    @Body() body: LoginByPasswordRequestDto,
    @Ip() ipAddress: string,
    @Headers("User-Agent") userAgent: string,
    @Req() request: UserRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginByPasswordResponseDto> {
    const loginResult = await this.authService.login({
      ipAddress,
      userAgent,
      userId: request.user.userId,
      response,
    });

    // Reset the per-IP login rate limit only when the login completed. An MFA
    // challenge keeps the limits — login is not complete until the TOTP step
    // succeeds.
    if (!("totpToken" in loginResult)) {
      await this.limitLoginByIpService.delete(ipAddress);
    }

    return loginResult;
  }

  /* End */
}
