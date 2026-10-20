import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  PermissionAuthorizer,
  PermissionRequirement,
  Scope,
} from "@modules/security/ports/permission.authorizer";
import {
  SCOPE_PERMISSION_CHECKER,
  ScopePermissionChecker,
} from "@modules/security/ports/scope-permission.authorizer";

/**
 * Account-side binding of security's PermissionAuthorizer port.
 *
 * System-level grants come from the Role→Permission table (via the UserRole
 * join) plus direct user grants (Permission.trustedUserId). Superuser status
 * is expressed as the ADMIN role holding `{ resource: "*", action: "Manage" }`
 * — there is no hardcoded admin bypass.
 *
 * Scoped (project) decisions are delegated to the host-bound
 * SCOPE_PERMISSION_CHECKER, since membership data is host-owned.
 */
@Injectable()
export class AccountPermissionAuthorizer implements PermissionAuthorizer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(SCOPE_PERMISSION_CHECKER)
    private readonly scopeChecker?: ScopePermissionChecker,
  ) {}

  async authorize(
    userId: string,
    { resource, action }: PermissionRequirement,
    scope?: Scope,
  ): Promise<boolean> {
    // Host-wide kill switch: when disabled, every permission check passes.
    if (this.config.get<boolean>("modules.account.rbacEnabled", true) === false) {
      return true;
    }

    // System-level grants: roles (via UserRole join) and direct user grants.
    const rolePermissions = await this.prisma.permission.findMany({
      where: {
        role: { users: { some: { userId } } },
      },
    });

    const userPermissions = await this.prisma.permission.findMany({
      where: { trustedUserId: userId },
    });

    for (const p of [...rolePermissions, ...userPermissions]) {
      if (
        (p.resource === resource || p.resource === "*") &&
        (p.action === action || p.action === PermissionAction.Manage)
      ) {
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
