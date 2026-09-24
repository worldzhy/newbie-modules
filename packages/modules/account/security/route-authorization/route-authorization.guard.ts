import {CanActivate, ExecutionContext, Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {TokenService} from '../token/token.service';
import {RouteAuthorizationService} from './route-authorization.service';
import {PermissionAction, UserRole} from '@generated/prisma/client';

@Injectable()
export class RouteAuthorizationGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly routeAuthorizationService: RouteAuthorizationService
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

    const user = await this.prisma.user.findUniqueOrThrow({
      where: {id: payload.userId},
    });

    if (user.roles.length > 0) {
      if (user.roles.includes(UserRole.ADMIN)) {
        return true;
      }
      const rolePermissions = await this.prisma.permission.findMany({
        where: {trustedUserRole: {in: user.roles}},
      });
      for (let i = 0; i < rolePermissions.length; i++) {
        const permission = rolePermissions[i];
        if (
          permission.resource === requiredPermission.resource &&
          (permission.action === requiredPermission.action || permission.action === PermissionAction.Manage)
        ) {
          return true;
        }
      }
    }

    const userPermissions = await this.prisma.permission.findMany({
      where: {trustedUserId: user.id},
    });
    for (let i = 0; i < userPermissions.length; i++) {
      const permission = userPermissions[i];
      if (
        permission.resource === requiredPermission.resource &&
        (permission.action === requiredPermission.action || permission.action === PermissionAction.Manage)
      ) {
        return true;
      }
    }

    return false;
  }
}
