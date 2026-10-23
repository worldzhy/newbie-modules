import { SetMetadata } from "@nestjs/common";
import { PermissionRequirement } from "../ports/permission.authorizer";

export const PERMISSION_KEY = "permission";

export interface RequirePermissionOptions {
  /**
   * @deprecated Legacy scope-resolver key (ADR-017). Modules must not name host
   * vocabulary ("project", "task", "application", ...) in decorators.
   *
   * Preferred: list the resource in the host's `HOST_SCOPED_RESOURCES` config;
   * the AuthorizationGuard then iterates the registered ScopeResolvers in
   * host-controlled priority order and takes the first non-{type:"none"} scope.
   *
   * Still honoured for host app-layer controllers and not-yet-migrated modules:
   * when set, the Guard looks up this exact key in SCOPE_RESOLVERS and does not
   * iterate. Omit for a global (system-level) check.
   */
  scope?: string;
}

/**
 * Marks a route as requiring a resource permission.
 *
 * `action` and `resource` are plain strings on purpose: security does not own
 * a permission data model. Identity providers pass their own enum values
 * (e.g. PermissionAction.Get / Prisma.ModelName.User), which are strings.
 *
 * Argument order is verb-object (action, resource) for readability at call
 * sites; metadata is stored in the canonical PermissionRequirement shape.
 */
export const RequirePermission = (action: string, resource: string, options: RequirePermissionOptions = {}) =>
  SetMetadata(PERMISSION_KEY, {
    resource,
    action,
    scope: options.scope,
  } satisfies PermissionRequirement & { scope?: string });
