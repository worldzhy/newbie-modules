import { Scope } from "./permission.authorizer";

/**
 * SPI port for scope-level (e.g. project) permission decisions (ADR-048).
 *
 * A resolved scope is the sole criterion for a route: the identity provider
 * must not OR it with system-level grants, so this check runs even when the
 * caller holds such a grant. Routes without scope semantics (resources not
 * registered in the host's `HOST_SCOPED_RESOURCES`) keep using the
 * system-level Role→Permission paths and never reach this port.
 *
 * Hosts bind an implementation that knows about their membership data model
 * (e.g. ProjectMember) and role-permission matrix. The registry does not
 * provide a default implementation — project scopes are host-owned. When no
 * implementation is bound, a scoped decision is denied rather than silently
 * downgraded.
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
