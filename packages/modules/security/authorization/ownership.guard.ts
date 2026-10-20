import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OWNER_KEY } from "./require-owner.decorator";
import {
  PERMISSION_AUTHORIZER,
  PermissionAuthorizer,
} from "../ports/permission.authorizer";
import { AccessTokenParsed } from "../security.interface";

/**
 * Enforces the `@RequireOwner` constraint: the route's `:userId` param must
 * match the authenticated user. Non-owners are denied unless they hold the
 * system-level superuser permission (`{ resource: "*", action: "Manage" }`),
 * which is resolved through the bound PermissionAuthorizer (no hardcoded
 * admin role).
 *
 * Registered as a global APP_GUARD; only routes carrying @RequireOwner are
 * affected (returns true otherwise).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissionAuthorizer?: PermissionAuthorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireOwner = this.reflector.getAllAndOverride<boolean>(OWNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requireOwner) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AccessTokenParsed;
      params: { userId?: string };
    }>();

    const currentUser = request.user;
    if (!currentUser) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const ownerId = request.params?.userId;
    if (ownerId && ownerId === currentUser.userId) {
      return true;
    }

    // Superuser override: resolved through the RBAC authorizer rather than a
    // hardcoded admin role, so superuser status is auditable and revocable.
    if (this.permissionAuthorizer) {
      const isSuperuser = await this.permissionAuthorizer.authorize(currentUser.userId, {
        resource: "*",
        action: "Manage",
      });
      if (isSuperuser) {
        return true;
      }
    }

    throw new ForbiddenException("You can only access your own resources.");
  }
}
