import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PermissionAuthorizer, PermissionRequirement, Scope } from "@modules/security/ports/permission.authorizer";
import { SCOPE_PERMISSION_CHECKER, ScopePermissionChecker } from "@modules/security/ports/scope-permission.authorizer";

/**
 * Checks whether a grant matches a required permission, with wildcard support.
 * - resource "*" matches any resource
 * - action "Manage" matches any action
 */
function matches(
  required: { action: string; resource: string },
  grant: { action: PermissionAction | string; resource: string },
): boolean {
  const resourceOk = grant.resource === required.resource || grant.resource === "*";
  const actionOk = grant.action === required.action || grant.action === PermissionAction.Manage;
  return resourceOk && actionOk;
}

/**
 * Account-side binding of security's PermissionAuthorizer port.
 *
 * System-level grants come from two UNION paths (all are legitimate sources):
 * 1. Role → Permission OR trustedUserId → Permission (merged, both hit Permission table, 1 findMany)
 * 2. Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission (main path, 1 findMany)
 *
 * Superuser status is expressed as the ADMIN role holding `{ resource: "*", action: "Manage" }`
 * via path 1 — there is no hardcoded admin bypass.
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
