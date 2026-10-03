import { SetMetadata } from "@nestjs/common";
import { PermissionRequirement } from "../ports/permission.authorizer";

export const PERMISSION_KEY = "permission";

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
export const RequirePermission = (action: string, resource: string) =>
  SetMetadata(PERMISSION_KEY, { resource, action } satisfies PermissionRequirement);
