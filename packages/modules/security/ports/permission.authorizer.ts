/**
 * SPI port for resource/action authorization decisions. The security module
 * parses the token and reads the required permission metadata; the identity
 * provider (e.g. account) owns the permission/role data model and decides.
 *
 * Resource and action are intentionally plain strings so that security does
 * not depend on any provider-specific generated enums.
 */

export const PERMISSION_AUTHORIZER = Symbol("PERMISSION_AUTHORIZER");

/**
 * The single permission shape shared by the decorator metadata, the route
 * authorization configuration and the SPI call boundary.
 */
export interface PermissionRequirement {
  resource: string;
  action: string;
}

export interface PermissionAuthorizer {
  /**
   * Returns true when the user (or one of their roles) holds the required
   * permission for the resource/action pair.
   */
  authorize(userId: string, requirement: PermissionRequirement): Promise<boolean>;
}
