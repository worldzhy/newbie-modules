import {Global, Module} from '@nestjs/common';
import {SecurityModule} from '../security/security.module';

import {LoginByApiKeyController} from './login-by-apikey.controller';
import {LoginByApprovedSubnetController} from './login-by-approved-subnet.controller';
import {LoginByGoogleController} from './login-by-google.controller';
import {LoginByPasswordController} from './login-by-password.controller';
import {LoginByProfileController} from './login-by-profile.controller';
import {LoginByVerificationCodeController} from './login-by-verificationcode.controller';
import {LogoutController} from './logout.controller';
import {RefreshAccessTokenController} from './refresh-access-token.controller';
import {SignupEmailVerifyController} from './signup-email-verify.controller';
import {SignupController} from './signup.controller';
import {WechatAuthController} from './wechat/auth.controller';

import {AuthService} from './auth.service';
import {WechatAuthService} from './wechat/auth.service';

@Global()
@Module({
  imports: [SecurityModule],
  controllers: [
    LoginByApiKeyController,
    LoginByApprovedSubnetController,
    LoginByGoogleController,
    LoginByPasswordController,
    LoginByProfileController,
    LoginByVerificationCodeController,
    LogoutController,
    RefreshAccessTokenController,
    SignupEmailVerifyController,
    SignupController,
    WechatAuthController,
  ],
  providers: [AuthService, WechatAuthService],
  exports: [AuthService, WechatAuthService],
})
export class AuthModule {}
