import {Module} from '@nestjs/common';
import {APP_GUARD} from '@nestjs/core';

import {CookieModule} from './cookie/cookie.module';
import {TokenModule} from './token/token.module';

import {RateLimiterGuard} from './rate-limiter/rate-limiter.guard';
import {PassportGuard} from './passport/passport.guard';
import {AuthorizationGuard} from './authorization/authorization.guard';
import {RouteAuthorizationService} from './route-authorization/route-authorization.service';
import {NoAuthGuard} from './passport/public/public.guard';
import {ApiKeyAuthGuard} from './passport/api-key/api-key.guard';
import {GoogleAuthGuard} from './passport/google-oauth/google.guard';
import {JwtAuthGuard} from './passport/jwt/jwt.guard';
import {PasswordAuthGuard} from './passport/password/password.guard';
import {ProfileAuthGuard} from './passport/profile/profile.guard';
import {RefreshTokenAuthGuard} from './passport/refresh-token/refresh-token.guard';
import {UuidAuthGuard} from './passport/uuid/uuid.guard';
import {VerificationCodeAuthGuard} from './passport/verification-code/verification-code.guard';

import {NoStrategy} from './passport/public/public.strategy';
import {ApiKeyStrategy} from './passport/api-key/api-key.strategy';
import {GoogleStrategy} from './passport/google-oauth/google.strategy';
import {JwtStrategy} from './passport/jwt/jwt.strategy';
import {PasswordStrategy} from './passport/password/password.strategy';
import {ProfileStrategy} from './passport/profile/profile.strategy';
import {RefreshTokenStrategy} from './passport/refresh-token/refresh-token.strategy';
import {UuidStrategy} from './passport/uuid/uuid.strategy';
import {VerificationCodeStrategy} from './passport/verification-code/verification-code.strategy';

import {
  LimitAccessByIpService,
  LimitLoginByIpService,
  LimitLoginByUserService,
} from './rate-limiter/rate-limiter.service';
import {RouteAuthenticationService} from './route-authentication/route-authentication.service';

import {RouteAuthenticationGuard} from './route-authentication/route-authentication.guard';
import {RouteAuthorizationGuard} from './route-authorization/route-authorization.guard';

@Module({
  imports: [CookieModule, TokenModule],
  providers: [
    RouteAuthenticationService,
    RouteAuthorizationService,
    {provide: APP_GUARD, useClass: RateLimiterGuard}, // 1nd priority guard.
    {provide: APP_GUARD, useClass: PassportGuard}, // 2rd priority guard.
    {provide: APP_GUARD, useClass: RouteAuthenticationGuard}, // 3th priority guard (Specific Route Auth)
    {provide: APP_GUARD, useClass: AuthorizationGuard}, // 4th priority guard.
    {provide: APP_GUARD, useClass: RouteAuthorizationGuard}, // 5th priority guard (Specific Route Authorization)
    NoAuthGuard,
    ApiKeyAuthGuard,
    GoogleAuthGuard,
    JwtAuthGuard,
    PasswordAuthGuard,
    ProfileAuthGuard,
    RefreshTokenAuthGuard,
    UuidAuthGuard,
    VerificationCodeAuthGuard,

    NoStrategy,
    ApiKeyStrategy,
    GoogleStrategy,
    JwtStrategy,
    PasswordStrategy,
    ProfileStrategy,
    RefreshTokenStrategy,
    UuidStrategy,
    VerificationCodeStrategy,

    LimitAccessByIpService,
    LimitLoginByIpService,
    LimitLoginByUserService,
  ],
  exports: [
    LimitAccessByIpService,
    LimitLoginByIpService,
    LimitLoginByUserService,
    RouteAuthenticationService,
    RouteAuthorizationService,
  ],
})
export class SecurityModule {}
