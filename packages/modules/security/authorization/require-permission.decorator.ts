import { SetMetadata } from "@nestjs/common";
import { PermissionRequirement } from "../ports/permission.authorizer";

export const PERMISSION_KEY = "permission";

export interface RequirePermissionOptions {
  /**
   * Scope resolver key. When set, the AuthorizationGuard looks up the
   * registered ScopeResolver (via SCOPE_RESOLVERS) and passes the resolved
   * Scope to PermissionAuthorizer. Omit for a global (system-level) check.
   *
   * The default "project" resolver reads `request.params.projectId`. Hosts
   * may register custom resolvers for sub-resources.
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
