import { Injectable, ExecutionContext } from "@nestjs/common";
import { RouteAuthenticationService } from "./route-authentication.service";
import { GuardType } from "./guard.types";
import { ApiKeyAuthGuard } from "./api-key/api-key.guard";
import { JwtAuthGuard } from "./jwt/jwt.guard";
import { PasswordAuthGuard } from "./password/password.guard";
import { VerificationCodeAuthGuard } from "./verification-code/verification-code.guard";
import { RefreshTokenAuthGuard } from "./refresh-token/refresh-token.guard";
import { GoogleAuthGuard } from "./google-oauth/google.guard";

@Injectable()
export class RouteAuthenticationGuard {
  constructor(
    private readonly routeAuthenticationService: RouteAuthenticationService,
    private readonly apiKeyAuthGuard: ApiKeyAuthGuard,
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly passwordAuthGuard: PasswordAuthGuard,
    private readonly verificationCodeAuthGuard: VerificationCodeAuthGuard,
    private readonly refreshTokenAuthGuard: RefreshTokenAuthGuard,
    private readonly googleAuthGuard: GoogleAuthGuard,
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
