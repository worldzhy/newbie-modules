import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "permission";

/**
 * Marks a route as requiring a resource permission.
 *
 * `action` and `resource` are plain strings on purpose: security does not own
 * a permission data model. Identity providers pass their own enum values
 * (e.g. PermissionAction.Get / Prisma.ModelName.User), which are strings.
 */
export const RequirePermission = (action: string, resource: string) =>
  SetMetadata(PERMISSION_KEY, { action, resource });
