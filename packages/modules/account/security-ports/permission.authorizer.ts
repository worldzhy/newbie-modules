import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PermissionAuthorizer, PermissionRequirement, Scope } from "@modules/security/ports/permission.authorizer";
import { SCOPE_PERMISSION_CHECKER, ScopePermissionChecker } from "@modules/security/ports/scope-permission.authorizer";

/**
 * Account-side binding of security's PermissionAuthorizer port.
 *
 * System-level grants come from two UNION paths (all are legitimate sources):
 * 1. Role → Permission OR trustedUserId → Permission (merged, both hit Permission table, 1 findFirst)
 * 2. Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission (main path, 1 findFirst)
 *
 * Superuser status is not a special case here: it is the union of every atomic
 * grant (the derived host-side "All" permission group bound to the admin role).
 * There is no hardcoded admin bypass and no wildcard matching.
 *
 * Scoped (project) decisions are delegated to the host-bound
 * SCOPE_PERMISSION_CHECKER, since membership data is host-owned.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- bound via the PERMISSION_AUTHORIZER useClass provider
export class AccountPermissionAuthorizer implements PermissionAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(SCOPE_PERMISSION_CHECKER)
    private readonly scopeChecker?: ScopePermissionChecker,
  ) {}

  async authorize(userId: string, { resource, action }: PermissionRequirement, scope?: Scope): Promise<boolean> {
    // Host-wide kill switch: when disabled, every permission check passes.
    if (this.config.get<boolean>("modules.account.rbacEnabled", true) === false) {
      return true;
    }

    // UNION path 1 (merged): Role → Permission OR trustedUserId → Permission
    // Both hit the same Prisma model — one query, pushed down to the exact
    // (resource, action) atom so a superuser's full grant set is never loaded.
    const directGrant = await this.prisma.permission.findFirst({
      where: {
        resource,
        action: action as PermissionAction,
        OR: [{ role: { users: { some: { userId } } } }, { trustedUserId: userId }],
      },
      select: { id: true },
    });

    if (directGrant) {
      return true;
    }

    // UNION path 2: Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission
    const groupGrant = await this.prisma.permissionGroupPermission.findFirst({
      where: {
        resource,
        action: action as PermissionAction,
        permissionGroup: {
          roles: { some: { role: { users: { some: { userId } } } } },
        },
      },
      select: { id: true },
    });

    if (groupGrant) {
      return true;
    }

    // No system-level grant; defer to the host's scope checker if present.
    if (scope && this.scopeChecker) {
      return this.scopeChecker.check(userId, resource, action, scope);
    }

    return false;
  }
}
