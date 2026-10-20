import { Scope } from "./permission.authorizer";

/**
 * SPI port for scope-level (e.g. project) permission decisions.
 *
 * The system-level PermissionAuthorizer (bound by the identity provider, e.g.
 * account) handles Role→Permission grants. When a route declares a scope and
 * no system-level grant matches, the AuthorizationGuard delegates to this
 * port to check membership-based permissions.
 *
 * Hosts bind an implementation that knows about their membership data model
 * (e.g. ProjectMember) and role-permission matrix. The registry does not
 * provide a default implementation — project scopes are host-owned.
 */
export const SCOPE_PERMISSION_CHECKER = Symbol("SCOPE_PERMISSION_CHECKER");

export interface ScopePermissionChecker {
  /**
   * Returns true when the user holds the required action on the resource
   * within the given scope (e.g. is a member of the project with sufficient
   * role rank).
   */
  check(userId: string, resource: string, action: string, scope: Scope): Promise<boolean>;
}
