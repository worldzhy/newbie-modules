import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OWNER_KEY } from "./require-owner.decorator";
import { AccessTokenParsed } from "../security.interface";

/**
 * Enforces the `@RequireOwner` constraint: the route's `:userId` param must
 * match the authenticated user.
 *
 * There is deliberately no administrator bypass. Reading or mutating another
 * user's sessions, API keys or approved subnets is impersonation-grade, so if
 * the product ever needs it the capability must be granted explicitly (and
 * audited) rather than inferred from "can edit users".
 *
 * Registered as a global APP_GUARD; only routes carrying @RequireOwner are
 * affected (returns true otherwise).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

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

    throw new ForbiddenException("You can only access your own resources.");
  }
}
