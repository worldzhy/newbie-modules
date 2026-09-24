import {Controller, Post, Req, Res} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags, ApiBearerAuth} from '@nestjs/swagger';
import {Response} from 'express';
import {CookieName, CookieService} from '@microservices/account/security/cookie/cookie.service';
import {TokenService} from '@microservices/account/security/token/token.service';
import {LimitLoginByUserService} from '@microservices/account/security/rate-limiter/rate-limiter.service';
import {SessionService} from '@microservices/account/modules/session/session.service';
import {LogoutResponseDto} from '@microservices/account/auth/auth.dto';

@ApiTags('Account / Auth')
@Controller('auth')
export class LogoutController {
  constructor(
    private readonly cookieService: CookieService,
    private readonly tokenService: TokenService,
    private readonly limitLoginByUserService: LimitLoginByUserService,
    private readonly sessionService: SessionService
  ) {}

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({summary: 'Logout the current user'})
  @ApiResponse({type: LogoutResponseDto})
  async logout(@Req() req, @Res({passthrough: true}) response: Response): Promise<{data: {message: string}}> {
    // [step 1] Get access token.
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);

    // [step 2] Delete session and clear user attempts.
    if (accessToken) {
      await this.sessionService.destroy(accessToken);

      const {userId} = this.tokenService.verifyUserAccessToken(accessToken);
      await this.limitLoginByUserService.delete(userId);
    }

    // [step 3] Clear cookie
    this.cookieService.clear(response, CookieName.REFRESH_TOKEN);

    // [step 4] Always return success no matter if the user exists.
    return {
      data: {message: 'User logs out successfully'},
    };
  }

  /* End */
}
