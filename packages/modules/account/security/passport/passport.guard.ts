import {Injectable, ExecutionContext} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Reflector} from '@nestjs/core';
import {AuthGuard} from '@nestjs/passport';
import {NoAuthGuard} from './public/public.guard';
import {ApiKeyAuthGuard} from './api-key/api-key.guard';
import {JwtAuthGuard} from './jwt/jwt.guard';
import {PasswordAuthGuard} from './password/password.guard';
import {ProfileAuthGuard} from './profile/profile.guard';
import {RefreshTokenAuthGuard} from './refresh-token/refresh-token.guard';
import {UuidAuthGuard} from './uuid/uuid.guard';
import {VerificationCodeAuthGuard} from './verification-code/verification-code.guard';
import {GoogleAuthGuard} from './google-oauth/google.guard';
import {IS_PUBLIC_KEY} from './public/public.decorator';
import {IS_LOGGING_IN_PASSWORD_KEY} from './password/password.decorator';
import {IS_LOGGING_IN_PROFILE_KEY} from './profile/profile.decorator';
import {IS_LOGGING_IN_UUID_KEY} from './uuid/uuid.decorator';
import {IS_LOGGING_IN_VERIFICATION_CODE_KEY} from './verification-code/verification-code.decorator';
import {IS_REFRESHING_ACCESS_TOKEN_KEY} from './refresh-token/refresh-token.decorator';
import {IS_LOGGING_IN_APIKEY_KEY} from './api-key/api-key.decorator';
import {IS_LOGGING_IN_GOOGLE_KEY} from './google-oauth/google.decorator';
import {RouteAuthenticationService} from '../route-authentication/route-authentication.service';
import {GuardType} from './guard.types';

@Injectable()
export class PassportGuard extends AuthGuard('authentication') {
  constructor(
    private readonly config: ConfigService,
    private readonly routeAuthenticationService: RouteAuthenticationService,
    private reflector: Reflector,
    private noAuthGuard: NoAuthGuard,
    private passwordAuthGuard: PasswordAuthGuard,
    private apiKeyAuthGuard: ApiKeyAuthGuard,
    private profileAuthGuard: ProfileAuthGuard,
    private uuidAuthGuard: UuidAuthGuard,
    private verificationCodeAuthGuard: VerificationCodeAuthGuard,
    private refreshTokenAuthGuard: RefreshTokenAuthGuard,
    private googleAuthGuard: GoogleAuthGuard,
    private jwtAuthGuard: JwtAuthGuard
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    // ! Skip authentication for configured public routes
    if (this.routeAuthenticationService.isPublic(req.url, req.method)) {
      return true;
    }

    // Use @NoGuard() for non-authentication
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return this.noAuthGuard.canActivate(context);
    }

    // Use @GuardByPassword() for local.password strategy authentication
    const isLoggingInByPassword = this.reflector.getAllAndOverride<boolean>(IS_LOGGING_IN_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isLoggingInByPassword) {
      return this.passwordAuthGuard.canActivate(context);
    }

    // Use @GuardByApiKey() for custom.api-key endpoint authentication
    const isLoggingInByApiKey = this.reflector.getAllAndOverride<boolean>(IS_LOGGING_IN_APIKEY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isLoggingInByApiKey) {
      return this.apiKeyAuthGuard.canActivate(context);
    }

    // Use @GuardByProfile() for custom.profile strategy authentication
    const isLoggingInByProfile = this.reflector.getAllAndOverride<boolean>(IS_LOGGING_IN_PROFILE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isLoggingInByProfile) {
      return this.profileAuthGuard.canActivate(context);
    }

    // Use @GuardByUuid() for custom.uuid strategy authentication
    const isLoggingInByUuid = this.reflector.getAllAndOverride<boolean>(IS_LOGGING_IN_UUID_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isLoggingInByUuid) {
      return this.uuidAuthGuard.canActivate(context);
    }

    // Use @GuardByVerificationCode() for local.verification-code strategy authentication
    const isLoggingInByVerificationCode = this.reflector.getAllAndOverride<boolean>(
      IS_LOGGING_IN_VERIFICATION_CODE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (isLoggingInByVerificationCode) {
      return this.verificationCodeAuthGuard.canActivate(context);
    }

    // Use @GuardByRefreshToken() for refresh endpoint authentication
    const isRefreshingAccessToken = this.reflector.getAllAndOverride<boolean>(IS_REFRESHING_ACCESS_TOKEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRefreshingAccessToken) {
      return this.refreshTokenAuthGuard.canActivate(context);
    }

    // Use @GuardByGoogle() for google-oauth strategy authentication
    const isLoggingInByGoogle = this.reflector.getAllAndOverride<boolean>(IS_LOGGING_IN_GOOGLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isLoggingInByGoogle) {
      return this.googleAuthGuard.canActivate(context);
    }

    // JWT guard is the default guard.
    const defaultGuard =
      (this.config.get<string>('microservices.account.security.defaultGuard') as GuardType) || GuardType.JWT;

    switch (defaultGuard) {
      case GuardType.NONE:
        return this.noAuthGuard.canActivate(context);
      case GuardType.PASSWORD:
        return this.passwordAuthGuard.canActivate(context);
      case GuardType.API_KEY:
        return this.apiKeyAuthGuard.canActivate(context);
      case GuardType.PROFILE:
        return this.profileAuthGuard.canActivate(context);
      case GuardType.UUID:
        return this.uuidAuthGuard.canActivate(context);
      case GuardType.VERIFICATION_CODE:
        return this.verificationCodeAuthGuard.canActivate(context);
      case GuardType.REFRESH_TOKEN:
        return this.refreshTokenAuthGuard.canActivate(context);
      case GuardType.GOOGLE:
        return this.googleAuthGuard.canActivate(context);
      case GuardType.JWT:
      default:
        return this.jwtAuthGuard.canActivate(context);
    }
  }
}
