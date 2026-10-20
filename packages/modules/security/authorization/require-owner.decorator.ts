import { SetMetadata } from "@nestjs/common";

export const OWNER_KEY = "requireOwner";

/**
 * Marks a route as restricted to the owner of the path resource.
 *
 * The route must carry a `:userId` param. The OwnershipGuard compares it
 * against the authenticated user's id; a match grants access. Users holding
 * the system-level `{ resource: "*", action: "Manage" }` permission bypass
 * the ownership check (superuser override).
 *
 * This is a separate access-control model from RBAC (`@RequirePermission`):
 * ownership checks data identity, not roles/permissions. The two decorators
 * are orthogonal and may be combined on the same route.
 */
export const RequireOwner = () => SetMetadata(OWNER_KEY, true);
