import {Controller, Post, Body, Ip, Req} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {NoGuard} from '@modules/account/security/passport/public/public.decorator';
import {GuardByRefreshToken} from '@modules/account/security/passport/refresh-token/refresh-token.decorator';
import {TokenService} from '@modules/account/security/token/token.service';
import {LimitLoginByUserService} from '@modules/account/security/rate-limiter/rate-limiter.service';
import {SessionService} from '@modules/account/modules/session/session.service';
import {WechatAuthService} from '@modules/account/auth/wechat/auth.service';
import {
  WechatLoginDto,
  WechatLoginResponseDto,
  WechatRefreshAccessTokenResponseDto,
} from '@modules/account/auth/wechat/auth.dto';
import {LogoutResponseDto} from '@modules/account/auth/auth.dto';

@ApiTags('Account / Auth / Wechat')
@Controller('auth/wechat')
export class WechatAuthController {
  constructor(
    private readonly tokenService: TokenService,
    private readonly limitLoginByUserService: LimitLoginByUserService,
    private readonly sessionService: SessionService,
    private readonly wechatAuthService: WechatAuthService
  ) {}

  @NoGuard()
  @Post('login')
  @ApiOperation({summary: 'WeChat mini-program login'})
  @ApiResponse({type: WechatLoginResponseDto})
  async login(@Ip() ipAddress: string, @Body() body: WechatLoginDto) {
    return await this.wechatAuthService.login({
      ipAddress,
      userAgent: 'mini-program',
      phone: body.phone,
      openId: body.openId,
    });
  }

  @Post('logout')
  @ApiOperation({summary: 'WeChat logout'})
  @ApiResponse({type: LogoutResponseDto})
  async logout(@Req() req): Promise<{data: {message: string}}> {
    // [step 1] Get access token.
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);

    // [step 2] Delete session and clear user attempts.
    if (accessToken) {
      await this.sessionService.destroy(accessToken);

      const {userId} = this.tokenService.verifyUserAccessToken(accessToken);
      await this.limitLoginByUserService.delete(userId);
    }

    // [step 3] Always return success no matter if the user exists.
    return {
      data: {message: 'User logs out successfully'},
    };
  }

  @GuardByRefreshToken()
  @Post('refresh-access-token')
  @ApiOperation({summary: 'WeChat refresh access token'})
  @ApiResponse({type: WechatRefreshAccessTokenResponseDto})
  async refresh(@Body() body: {refreshToken: string}) {
    return await this.wechatAuthService.refreshAccessToken({
      refreshToken: body.refreshToken,
    });
  }

  /* End */
}
