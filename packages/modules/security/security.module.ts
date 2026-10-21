import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CookieModule } from "./cookie/cookie.module";
import { TokenModule } from "./token/token.module";

import { RateLimiterGuard } from "./rate-limiter/rate-limiter.guard";
import { AuthenticationGuard } from "./authentication/authentication.guard";
import { AuthorizationGuard } from "./authorization/authorization.guard";
import { NoAuthGuard } from "./authentication/public/public.guard";
import { ApiKeyAuthGuard } from "./authentication/api-key/api-key.guard";
import { GoogleAuthGuard } from "./authentication/google-oauth/google.guard";
import { InstallationAuthGuard } from "./authentication/installation/installation.guard";
import { JwtAuthGuard } from "./authentication/jwt/jwt.guard";
import { PasswordAuthGuard } from "./authentication/password/password.guard";
import { RefreshTokenAuthGuard } from "./authentication/refresh-token/refresh-token.guard";
import { VerificationCodeAuthGuard } from "./authentication/verification-code/verification-code.guard";

import { NoStrategy } from "./authentication/public/public.strategy";
import { ApiKeyStrategy } from "./authentication/api-key/api-key.strategy";
import { JwtStrategy } from "./authentication/jwt/jwt.strategy";

import {
  LimitAccessByIpService,
  LimitInstallationByTokenService,
  LimitLoginByIpService,
  LimitLoginByUserService,
  LimitTotpLoginByUserService,
} from "./rate-limiter/rate-limiter.service";
import { OwnershipGuard } from "./authorization/ownership.guard";

/**
 * Foundation security machinery: the global guard pipeline, authentication
 * mechanisms (none/JWT/API-key strategies under ./authentication),
 * token/cookie services and rate limiting.
 *
 * Identity-specific strategies (password, verification-code, refresh-token,
 * Google) and all data access live in the identity provider module (account),
 * which binds the SPI ports under ./ports.
 *
 * SCOPE_RESOLVERS is intentionally NOT provided here — it is a host-owned
 * SPI token. Hosts register their scope resolvers (the default "project"
 * resolver plus any sub-resource resolvers) via their own module. The
 * AuthorizationGuard falls back to defaultProjectScopeResolver for the
 * "project" key when no host resolver is registered.
 */
@Global()
@Module({
  imports: [CookieModule, TokenModule],
  providers: [
    { provide: APP_GUARD, useClass: RateLimiterGuard }, // 1st priority guard.
    { provide: APP_GUARD, useClass: AuthenticationGuard }, // 2nd priority guard.
    { provide: APP_GUARD, useClass: AuthorizationGuard }, // 3rd priority guard.
    OwnershipGuard,
    { provide: APP_GUARD, useExisting: OwnershipGuard }, // 4th priority guard.
    NoAuthGuard,
    ApiKeyAuthGuard,
    GoogleAuthGuard,
    InstallationAuthGuard,
    JwtAuthGuard,
    PasswordAuthGuard,
    RefreshTokenAuthGuard,
    VerificationCodeAuthGuard,

    NoStrategy,
    ApiKeyStrategy,
    JwtStrategy,

    LimitAccessByIpService,
    LimitLoginByIpService,
    LimitLoginByUserService,
    LimitInstallationByTokenService,
    LimitTotpLoginByUserService,
  ],
  exports: [
    LimitAccessByIpService,
    LimitLoginByIpService,
    LimitLoginByUserService,
    LimitInstallationByTokenService,
    LimitTotpLoginByUserService,
    TokenModule,
    CookieModule,
    JwtAuthGuard,
    ApiKeyAuthGuard,
    OwnershipGuard,
  ],
})
export class SecurityModule {}
