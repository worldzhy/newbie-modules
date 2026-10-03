import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CookieModule } from "./cookie/cookie.module";
import { TokenModule } from "./token/token.module";

import { RateLimiterGuard } from "./rate-limiter/rate-limiter.guard";
import { PassportGuard } from "./passport/passport.guard";
import { AuthorizationGuard } from "./authorization/authorization.guard";
import { RouteAuthorizationService } from "./route-authorization/route-authorization.service";
import { NoAuthGuard } from "./passport/public/public.guard";
import { ApiKeyAuthGuard } from "./passport/api-key/api-key.guard";
import { GoogleAuthGuard } from "./passport/google-oauth/google.guard";
import { JwtAuthGuard } from "./passport/jwt/jwt.guard";
import { PasswordAuthGuard } from "./passport/password/password.guard";
import { RefreshTokenAuthGuard } from "./passport/refresh-token/refresh-token.guard";
import { VerificationCodeAuthGuard } from "./passport/verification-code/verification-code.guard";

import { NoStrategy } from "./passport/public/public.strategy";
import { ApiKeyStrategy } from "./passport/api-key/api-key.strategy";
import { JwtStrategy } from "./passport/jwt/jwt.strategy";

import {
  LimitAccessByIpService,
  LimitLoginByIpService,
  LimitLoginByUserService,
} from "./rate-limiter/rate-limiter.service";
import { RouteAuthenticationService } from "./route-authentication/route-authentication.service";

import { RouteAuthenticationGuard } from "./route-authentication/route-authentication.guard";
import { RouteAuthorizationGuard } from "./route-authorization/route-authorization.guard";
import { SelfOnlyGuard } from "./self-only/self-only.guard";

/**
 * Foundation security machinery: the global guard pipeline, passport
 * strategies for credential-less mechanisms (none/JWT/API-key), token/cookie
 * services, rate limiting and route-level auth configuration.
 *
 * Identity-specific strategies (password, verification-code, refresh-token,
 * Google) and all data access live in the identity provider module (account),
 * which binds the SPI ports under ./ports.
 */
@Global()
@Module({
  imports: [CookieModule, TokenModule],
  providers: [
    RouteAuthenticationService,
    RouteAuthorizationService,
    { provide: APP_GUARD, useClass: RateLimiterGuard }, // 1nd priority guard.
    { provide: APP_GUARD, useClass: PassportGuard }, // 2rd priority guard.
    { provide: APP_GUARD, useClass: RouteAuthenticationGuard }, // 3th priority guard (Specific Route Auth)
    { provide: APP_GUARD, useClass: AuthorizationGuard }, // 4th priority guard.
    { provide: APP_GUARD, useClass: RouteAuthorizationGuard }, // 5th priority guard (Specific Route Authorization)
    NoAuthGuard,
    ApiKeyAuthGuard,
    GoogleAuthGuard,
    JwtAuthGuard,
    PasswordAuthGuard,
    RefreshTokenAuthGuard,
    VerificationCodeAuthGuard,
    SelfOnlyGuard,

    NoStrategy,
    ApiKeyStrategy,
    JwtStrategy,

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
    TokenModule,
    CookieModule,
    JwtAuthGuard,
    ApiKeyAuthGuard,
    SelfOnlyGuard,
  ],
})
export class SecurityModule {}
