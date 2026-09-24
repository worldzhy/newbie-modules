import {Injectable, ExecutionContext} from '@nestjs/common';
import {RouteAuthenticationService} from './route-authentication.service';
import {GuardType} from '../passport/guard.types';
import {ApiKeyAuthGuard} from '../passport/api-key/api-key.guard';
import {JwtAuthGuard} from '../passport/jwt/jwt.guard';
import {PasswordAuthGuard} from '../passport/password/password.guard';
import {ProfileAuthGuard} from '../passport/profile/profile.guard';
import {UuidAuthGuard} from '../passport/uuid/uuid.guard';
import {VerificationCodeAuthGuard} from '../passport/verification-code/verification-code.guard';
import {RefreshTokenAuthGuard} from '../passport/refresh-token/refresh-token.guard';
import {GoogleAuthGuard} from '../passport/google-oauth/google.guard';

@Injectable()
export class RouteAuthenticationGuard {
  constructor(
    private readonly routeAuthenticationService: RouteAuthenticationService,
    private readonly apiKeyAuthGuard: ApiKeyAuthGuard,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly passwordAuthGuard: PasswordAuthGuard,
    private readonly profileAuthGuard: ProfileAuthGuard,
    private readonly uuidAuthGuard: UuidAuthGuard,
    private readonly verificationCodeAuthGuard: VerificationCodeAuthGuard,
    private readonly refreshTokenAuthGuard: RefreshTokenAuthGuard,
    private readonly googleAuthGuard: GoogleAuthGuard
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const guardType = this.routeAuthenticationService.getGuardForRoute(req.url, req.method);

    if (!guardType) {
      return true;
    }

    let guard: any;
    switch (guardType) {
      case GuardType.API_KEY:
        guard = this.apiKeyAuthGuard;
        break;
      case GuardType.JWT:
        guard = this.jwtAuthGuard;
        break;
      case GuardType.PASSWORD:
        guard = this.passwordAuthGuard;
        break;
      case GuardType.PROFILE:
        guard = this.profileAuthGuard;
        break;
      case GuardType.UUID:
        guard = this.uuidAuthGuard;
        break;
      case GuardType.VERIFICATION_CODE:
        guard = this.verificationCodeAuthGuard;
        break;
      case GuardType.REFRESH_TOKEN:
        guard = this.refreshTokenAuthGuard;
        break;
      case GuardType.GOOGLE:
        guard = this.googleAuthGuard;
        break;
      default:
        return true;
    }

    if (guard) {
      return guard.canActivate(context) as boolean;
    }
    return true;
  }
}
