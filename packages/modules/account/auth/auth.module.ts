import { Global, Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TwoFactorModule } from "../modules/two-factor/two-factor.module";

import { LoginByApprovedSubnetController } from "./login-by-approved-subnet.controller";
import { LoginByGoogleController } from "./login-by-google.controller";
import { LoginByLarkController } from "./login-by-lark.controller";
import { LoginByPasswordController } from "./login-by-password.controller";
import { LoginByTotpController } from "./login-by-totp.controller";
import { LoginByVerificationCodeController } from "./login-by-verificationcode.controller";
import { LogoutController } from "./logout.controller";
import { RefreshAccessTokenController } from "./refresh-access-token.controller";
import { SignupEmailVerifyController } from "./signup-email-verify.controller";
import { SignupController } from "./signup.controller";
import { WechatAuthController } from "./wechat/auth.controller";

import { AuthService } from "./auth.service";
import { WechatAuthService } from "./wechat/auth.service";
import { LarkAuthService } from "./lark/lark-auth.service";

// Login-flow passport strategies. They live in account (not in the security
// foundation module) because they orchestrate account data: users, sessions,
// verification codes. They register globally with passport by being providers.
import { PasswordStrategy } from "./strategies/password.strategy";
import { VerificationCodeStrategy } from "./strategies/verification-code.strategy";
import { RefreshTokenStrategy } from "./strategies/refresh-token.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";

@Global()
@Module({
  imports: [TwoFactorModule, HttpModule],
  controllers: [
    LoginByApprovedSubnetController,
    LoginByGoogleController,
    LoginByLarkController,
    LoginByPasswordController,
    LoginByTotpController,
    LoginByVerificationCodeController,
    LogoutController,
    RefreshAccessTokenController,
    SignupEmailVerifyController,
    SignupController,
    WechatAuthController,
  ],
  providers: [
    AuthService,
    WechatAuthService,
    LarkAuthService,
    PasswordStrategy,
    VerificationCodeStrategy,
    RefreshTokenStrategy,
    GoogleStrategy,
  ],
  exports: [AuthService, WechatAuthService, LarkAuthService],
})
export class AuthModule {}
