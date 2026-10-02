import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { UserRole } from "@generated/prisma/client";
import { AccessTokenParsed } from "../../account.interface";

/**
 * Restricts a route to the owner of the path resource.
 *
 * - A route carrying :userId is only reachable by that same user.
 * - A route carrying :organizationId currently requires the ADMIN role;
 *   organization access will be checked against memberships once that
 *   authorization system is implemented.
 * - ADMIN bypasses both checks.
 */
@Injectable()
export class SelfOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AccessTokenParsed;
      params: { userId?: string; organizationId?: string };
    }>();

    const currentUser = request.user;
    if (!currentUser) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const isAdmin = currentUser.roles?.includes(UserRole.ADMIN) ?? false;
    const { userId, organizationId } = request.params;

    if (organizationId) {
      if (!isAdmin) {
        throw new ForbiddenException("You cannot access resources of this organization.");
      }
      return true;
    }

    if (userId && userId !== currentUser.userId && !isAdmin) {
      throw new ForbiddenException("You can only access your own resources.");
    }

    return true;
  }
}
