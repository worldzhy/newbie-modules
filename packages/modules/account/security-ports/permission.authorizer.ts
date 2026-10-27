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
  required: { action: PermissionAction; resource: string },
  grant: { action: PermissionAction | string; resource: string },
): boolean {
  const resourceOk = grant.resource === required.resource || grant.resource === "*";
  const actionOk = grant.action === required.action || grant.action === PermissionAction.Manage;
  return resourceOk && actionOk;
}

/**
 * Account-side binding of security's PermissionAuthorizer port.
 *
 * System-level grants come from three UNION paths (all are legitimate sources):
 * 1. Role → Permission (direct grants — ADMIN wildcard `*:Manage` + admin fine-grained tweaks)
 * 2. Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission (main path, admin checks PermissionGroup checkboxes in UI)
 * 3. trustedUserId → Permission (temporary individual grants)
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

    // UNION path 1: Role → Permission (direct grants, includes ADMIN wildcard)
    const rolePermissions = await this.prisma.permission.findMany({
      where: {
        role: { users: { some: { userId } } },
      },
    });

    for (const p of rolePermissions) {
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

    // UNION path 3: trustedUserId → Permission (individual grants)
    const userPermissions = await this.prisma.permission.findMany({
      where: { trustedUserId: userId },
    });

    for (const p of userPermissions) {
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
