import { SetMetadata } from "@nestjs/common";

export const OWNER_KEY = "requireOwner";

/**
 * Marks a route as restricted to the owner of the path resource.
 *
 * The route should carry a `:userId` param (self-by-token routes without one
 * — /account/me, /account/logout — are accepted too, ownership holding by
 * construction). The OwnershipGuard compares the param against the
 * authenticated user's id; a match grants access.
 *
 * There is deliberately no administrator bypass. Reading or mutating another
 * user's sessions, API keys or approved subnets is impersonation-grade, so if
 * the product ever needs it the capability must be granted explicitly (and
 * audited) rather than inferred from "can edit users".
 *
 * This is a separate access-control model from RBAC (`@RequirePermission`):
 * ownership checks data identity, not roles/permissions. The two decorators
 * are orthogonal and may be combined on the same route.
 */
export const RequireOwner = () => SetMetadata(OWNER_KEY, true);
