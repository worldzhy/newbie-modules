import { CanActivate, ExecutionContext, Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSION_KEY } from "./authorization.decorator";
import { TokenService } from "../token/token.service";
import { PERMISSION_AUTHORIZER, PermissionAuthorizer } from "../ports/permission.authorizer";
import { Optional } from "@nestjs/common";

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly tokenService: TokenService,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissionAuthorizer?: PermissionAuthorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // [step 1] Get required permission.
    const requiredPermission = this.reflector.getAllAndOverride<{
      resource: string;
      action: string;
    }>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermission) {
      return true;
    }

    // [step 2] Parse JWT.
    const req = context.switchToHttp().getRequest();
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);
    if (accessToken === undefined) {
      return false;
    }
    const payload = this.tokenService.verifyUserAccessToken(accessToken);

    // [step 3] Delegate the permission decision to the identity provider.
    if (!this.permissionAuthorizer) {
      throw new InternalServerErrorException(
        "A route requires permission but no PERMISSION_AUTHORIZER is bound. Did the identity provider module load?",
      );
    }

    return this.permissionAuthorizer.authorize(payload.userId, requiredPermission.resource, requiredPermission.action);
  }
}
