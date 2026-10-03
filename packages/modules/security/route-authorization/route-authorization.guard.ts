import { CanActivate, ExecutionContext, Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { TokenService } from "../token/token.service";
import { RouteAuthorizationService } from "./route-authorization.service";
import { PERMISSION_AUTHORIZER, PermissionAuthorizer } from "../ports/permission.authorizer";

@Injectable()
export class RouteAuthorizationGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly routeAuthorizationService: RouteAuthorizationService,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissionAuthorizer?: PermissionAuthorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const policy = this.routeAuthorizationService.getPolicyForRoute(req.url, req.method);
    if (policy) {
      return await Promise.resolve(policy(req));
    }
    const requiredPermission = this.routeAuthorizationService.getPermissionForRoute(req.url, req.method);
    if (!requiredPermission) {
      return true;
    }

    const accessToken = this.tokenService.getTokenFromHttpRequest(req);
    if (accessToken === undefined) {
      return false;
    }
    const payload = this.tokenService.verifyUserAccessToken(accessToken);

    if (!this.permissionAuthorizer) {
      throw new InternalServerErrorException(
        "A route requires permission but no PERMISSION_AUTHORIZER is bound. Did the identity provider module load?",
      );
    }

    return this.permissionAuthorizer.authorize(payload.userId, requiredPermission.resource, requiredPermission.action);
  }
}
