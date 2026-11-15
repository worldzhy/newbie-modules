import { Controller, Post, Body, Ip, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { GuardByRefreshToken } from "@modules/security/authentication/refresh-token/refresh-token.decorator";
import { LimitLoginByUserService } from "@modules/security/rate-limiter/rate-limiter.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WechatAuthService } from "@modules/account/auth/wechat/auth.service";
import {
  WechatLoginDto,
  WechatLoginResponseDto,
  WechatRefreshAccessTokenResponseDto,
} from "@modules/account/auth/wechat/auth.dto";
import { LogoutResponseDto } from "@modules/account/auth/auth.dto";

@ApiTags("Account / Auth / Wechat")
@Controller("auth/wechat")
export class WechatAuthController {
  constructor(
    private readonly limitLoginByUserService: LimitLoginByUserService,
    private readonly sessionService: SessionService,
    private readonly wechatAuthService: WechatAuthService,
  ) {}

  @NoGuard()
  @Post("login")
  @ApiOperation({ summary: "WeChat mini-program login" })
  @ApiResponse({ type: WechatLoginResponseDto })
  async login(@Ip() ipAddress: string, @Body() body: WechatLoginDto) {
    return await this.wechatAuthService.login({
      ipAddress,
      userAgent: "mini-program",
      phone: body.phone,
      openId: body.openId,
    });
  }

  @Post("logout")
  @RequireOwner()
  @ApiOperation({ summary: "WeChat logout" })
  @ApiResponse({ type: LogoutResponseDto })
  async logout(@Req() req: UserRequest): Promise<{ data: { message: string } }> {
    // [step 1] The guard already resolved this request's session, so revoke by
    // the resolved id instead of re-parsing the token (devbie ADR-051).
    const { sessionId, userId } = req.user;
    // The JWT strategy always resolves a session id; a credential strategy that
    // carries none has no row to revoke, and the call is idempotent either way.
    if (sessionId !== undefined) {
      await this.sessionService.revokeSession(sessionId);
    }
    await this.limitLoginByUserService.delete(userId);

    // [step 2] Always return success no matter if the user exists.
    return {
      data: { message: "User logs out successfully" },
    };
  }

  @GuardByRefreshToken()
  @Post("refresh-access-token")
  @ApiOperation({ summary: "WeChat refresh access token" })
  @ApiResponse({ type: WechatRefreshAccessTokenResponseDto })
  async refresh(@Body() body: { refreshToken: string }) {
    return await this.wechatAuthService.refreshAccessToken({
      refreshToken: body.refreshToken,
    });
  }

  /* End */
}
