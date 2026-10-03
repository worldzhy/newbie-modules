import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CookieModule } from "./cookie/cookie.module";
import { TokenModule } from "./token/token.module";

import { RateLimiterGuard } from "./rate-limiter/rate-limiter.guard";
import { AuthenticationGuard } from "./authentication/authentication.guard";
import { AuthorizationGuard } from "./authorization/authorization.guard";
import { RouteAuthorizationService } from "./authorization/route-authorization.service";
import { NoAuthGuard } from "./authentication/public/public.guard";
import { ApiKeyAuthGuard } from "./authentication/api-key/api-key.guard";
import { GoogleAuthGuard } from "./authentication/google-oauth/google.guard";
import { JwtAuthGuard } from "./authentication/jwt/jwt.guard";
import { PasswordAuthGuard } from "./authentication/password/password.guard";
import { RefreshTokenAuthGuard } from "./authentication/refresh-token/refresh-token.guard";
import { VerificationCodeAuthGuard } from "./authentication/verification-code/verification-code.guard";

import { NoStrategy } from "./authentication/public/public.strategy";
import { ApiKeyStrategy } from "./authentication/api-key/api-key.strategy";
import { JwtStrategy } from "./authentication/jwt/jwt.strategy";

import {
  LimitAccessByIpService,
  LimitLoginByIpService,
  LimitLoginByUserService,
} from "./rate-limiter/rate-limiter.service";
import { RouteAuthenticationService } from "./authentication/route-authentication.service";

import { RouteAuthenticationGuard } from "./authentication/route-authentication.guard";
import { RouteAuthorizationGuard } from "./authorization/route-authorization.guard";
import { SelfOnlyGuard } from "./self-only/self-only.guard";

/**
 * Foundation security machinery: the global guard pipeline, authentication
 * mechanisms (none/JWT/API-key strategies under ./authentication),
 * token/cookie services, rate limiting and route-level auth configuration.
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
    { provide: APP_GUARD, useClass: RateLimiterGuard }, // 1st priority guard.
    { provide: APP_GUARD, useClass: AuthenticationGuard }, // 2nd priority guard.
    { provide: APP_GUARD, useClass: RouteAuthenticationGuard }, // 3rd priority guard (specific route auth)
    { provide: APP_GUARD, useClass: AuthorizationGuard }, // 4th priority guard.
    { provide: APP_GUARD, useClass: RouteAuthorizationGuard }, // 5th priority guard (specific route authorization)
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
