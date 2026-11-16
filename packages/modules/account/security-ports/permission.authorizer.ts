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
 * Scoped decisions would delegate to SCOPE_PERMISSION_CHECKER. Since ADR-047
 * retired project scope, this host binds no checker and no route carries a
 * `scope` key, so that branch is defensive only. Per ADR-048 a resolved scope
 * is the sole criterion when present — it never falls back to a system-level
 * grant.
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

    // ADR-048: a resolved scope is the only criterion. A `none` scope means the
    // route is scope-sensitive but the request could not be resolved, so it is a
    // gap to surface — never a reason to fall back to a system-level grant.
    if (scope) {
      if (scope.type === "none" || !this.scopeChecker) {
        return false;
      }
      return this.scopeChecker.check(userId, resource, action, scope);
    }

    // No scope semantics on this route: the two system-level UNION paths decide.
    // They span two tables (Permission / PermissionGroupPermission), so they
    // cannot be one OR query; running them in parallel keeps the decision at
    // one round-trip and the result is their union.
    const [directGrant, groupGrant] = await Promise.all([
      // UNION path 1: Role → Permission OR trustedUserId → Permission
      this.prisma.permission.findFirst({
        where: {
          resource,
          action: action as PermissionAction,
          OR: [{ role: { users: { some: { userId } } } }, { trustedUserId: userId }],
        },
        select: { id: true },
      }),
      // UNION path 2: Role → RolePermissionGroup → PermissionGroup → PermissionGroupPermission
      this.prisma.permissionGroupPermission.findFirst({
        where: {
          resource,
          action: action as PermissionAction,
          permissionGroup: {
            roles: { some: { role: { users: { some: { userId } } } } },
          },
        },
        select: { id: true },
      }),
    ]);

    return Boolean(directGrant || groupGrant);
  }
}
