import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PermissionAuthorizer, PermissionRequirement, Scope } from "@modules/security/ports/permission.authorizer";
import { SCOPE_PERMISSION_CHECKER, ScopePermissionChecker } from "@modules/security/ports/scope-permission.authorizer";

/**
 * Authorization = membership of an atomic (resource, action) pair.
 *
 * There is no wildcard on either axis: a grant covers exactly one resource and
 * exactly one action (ADR-044). "All permissions" is expressed as the full set
 * of atomic rows, never as a single catch-all row.
 */
function matches(
  required: { action: string; resource: string },
  grant: { action: PermissionAction | string; resource: string },
): boolean {
  return grant.resource === required.resource && grant.action === required.action;
}

/**
 * Account-side binding of security's PermissionAuthorizer port.
 *
 * System-level grants come from two UNION paths (all are legitimate sources):
 * 1. Role → Permission OR trustedUserId → Permission (merged, both hit Permission table, 1 findMany)
 * 2. Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission (main path, 1 findMany)
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
    // Both hit the same Prisma model — single findMany with OR is cheaper.
    const directPermissions = await this.prisma.permission.findMany({
      where: {
        OR: [{ role: { users: { some: { userId } } } }, { trustedUserId: userId }],
      },
    });

    for (const p of directPermissions) {
      if (matches({ resource, action }, p)) {
        return true;
      }
    }

    // UNION path 2: Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission
    const groupPermissions = await this.prisma.permissionGroupPermission.findMany({
      where: {
        permissionGroup: {
          roles: { some: { role: { users: { some: { userId } } } } },
        },
      },
    });

    for (const p of groupPermissions) {
      if (matches({ resource, action }, p)) {
        return true;
      }
    }

    // No system-level grant; defer to the host's scope checker if present.
    if (scope && this.scopeChecker) {
      return this.scopeChecker.check(userId, resource, action, scope);
    }

    return false;
  }
}
