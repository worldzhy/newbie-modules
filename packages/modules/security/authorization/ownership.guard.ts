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
import { PERMISSION_AUTHORIZER, PermissionAuthorizer } from "../ports/permission.authorizer";
import { AccessTokenParsed } from "../security.interface";

/**
 * Enforces the `@RequireOwner` constraint: the route's `:userId` param must
 * match the authenticated user. Non-owners are denied unless they are an
 * account administrator — expressed as holding `Update` on `User` (the IAM
 * permission group), resolved through the bound PermissionAuthorizer. There is
 * no wildcard grant and no hardcoded admin role (ADR-044).
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

    // Self-by-token routes (e.g. /account/me, /account/logout): no :userId
    // param means the operation inherently targets the authenticated user,
    // so ownership holds by construction.
    if (!ownerId) {
      return true;
    }

    // Administrator override: resolved through the RBAC authorizer rather than
    // a hardcoded admin role, so the capability is auditable and revocable.
    if (this.permissionAuthorizer) {
      const isAdministrator = await this.permissionAuthorizer.authorize(currentUser.userId, {
        resource: "User",
        action: "Update",
      });
      if (isAdministrator) {
        return true;
      }
    }

    throw new ForbiddenException("You can only access your own resources.");
  }
}
