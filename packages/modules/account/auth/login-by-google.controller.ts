import {Controller, Get, NotFoundException, Req} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {GuardByGoogle} from '@microservices/account/security/passport/google-oauth/google.decorator';
import {GoogleOAuthRedirectResponseDto} from '@microservices/account/auth/auth.dto';

/**
 * local dev, to change file node_modules/oauth/lib/oauth2.js
 *var HPA = require('https-proxy-agent');
  let httpsProxyAgent = null
  // fill in your proxy agent ip and port
  httpsProxyAgent = new HPA.HttpsProxyAgent("http://127.0.0.1:54960");
  // line codes to add
  options.agent = httpsProxyAgent;
  this._executeRequest( http_library, options, post_body, callback );
 */
@ApiTags('Account / Auth')
@Controller('auth')
export class LoginByGoogleController {
  constructor() {}

  @GuardByGoogle()
  @Get('login-by-google')
  @ApiOperation({summary: 'Initiate Google OAuth login (redirect)'})
  @ApiResponse({type: String})
  async signinWithGoogle() {}

  @GuardByGoogle()
  @Get('login-by-google/redirect')
  @ApiOperation({summary: 'Google OAuth redirect callback'})
  @ApiResponse({type: GoogleOAuthRedirectResponseDto})
  async googleOAuthredirect(@Req() req) {
    if (!req.user) return new NotFoundException('User google account not found');
    return {
      status: 'success',
      message: 'Login successfully',
      data: req.user,
    };
  }
}
