import { Injectable } from "@nestjs/common";
import { PermissionAction, UserRole } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PermissionAuthorizer } from "@modules/security/ports/permission.authorizer";

/**
 * Account-side binding of security's PermissionAuthorizer port. Encapsulates
 * the role/permission decision previously inlined in security's guards:
 * ADMIN bypasses; otherwise role grants and direct user grants are checked.
 */
@Injectable()
export class AccountPermissionAuthorizer implements PermissionAuthorizer {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(userId: string, resource: string, action: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (user.roles.length > 0) {
      if (user.roles.includes(UserRole.ADMIN)) {
        // If user is an admin, grant all permissions.
        return true;
      }

      const rolePermissions = await this.prisma.permission.findMany({
        where: { trustedUserRole: { in: user.roles } },
      });
      for (const permission of rolePermissions) {
        if (
          permission.resource === resource &&
          (permission.action === action || permission.action === PermissionAction.Manage)
        ) {
          return true;
        }
      }
    }

    const userPermissions = await this.prisma.permission.findMany({
      where: { trustedUserId: user.id },
    });
    for (const permission of userPermissions) {
      if (
        permission.resource === resource &&
        (permission.action === action || permission.action === PermissionAction.Manage)
      ) {
        return true;
      }
    }

    return false;
  }
}
