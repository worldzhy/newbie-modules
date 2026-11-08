/**
 * Message used when an authenticated caller targets a resource owned by
 * somebody else. Shared by OwnershipGuard (route-level) and the per-service
 * defense-in-depth checks, so clients see one stable string.
 */
export const FORBIDDEN_FOREIGN_RESOURCE = "You can only access your own resources.";
