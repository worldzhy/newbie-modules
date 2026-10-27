import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { PermissionResponseDto } from "../permission/permission.dto";
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

/**
 * Request DTO for creating a role. Roles created through the API are never
 * builtin; builtin roles (ADMIN, OPERATOR, MEMBER) are seeded by migrations only.
 */
export class CreateRoleDto {
  @ApiProperty({ type: String, description: "Unique role name.", minLength: 1, maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  name!: string;

  @ApiPropertyOptional({ type: String, description: "Optional human-readable description." })
  @IsString()
  @IsOptional()
  description?: string;
}

/**
 * Request DTO for updating a role. Only the display name/description can
 * change; permissions are managed through the Permission resource (roleId FK).
 */
export class UpdateRoleDto {
  @ApiPropertyOptional({ type: String, description: "Unique role name.", minLength: 1, maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;
}

/**
 * Response DTO for a single Role record, with the attached user count.
 */
export class RoleResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Boolean, description: "Builtin roles cannot be renamed or deleted." })
  isBuiltin!: boolean;

  @ApiPropertyOptional({ type: String })
  description?: string | null;

  @ApiProperty({ type: Number, description: "Number of users holding this role." })
  userCount!: number;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

/**
 * Paginated list response for roles.
 */
export class ListRolesResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: RoleResponseDto, isArray: true })
  declare records: RoleResponseDto[];
}

export class RolePermissionGroupSummaryDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  routePath!: string;

  @ApiProperty({ type: String })
  navGroup!: string;

  @ApiProperty({ type: String })
  navLabel!: string;

  @ApiPropertyOptional({ type: String })
  navIcon?: string | null;
}

/**
 * Response DTO for a role with its permissions AND permission groups.
 */
export class RoleDetailResponseDto extends RoleResponseDto {
  @ApiProperty({ type: PermissionResponseDto, isArray: true })
  permissions!: PermissionResponseDto[];

  @ApiProperty({ type: RolePermissionGroupSummaryDto, isArray: true })
  permissionGroups!: RolePermissionGroupSummaryDto[];
}

/**
 * Request DTO for replacing a role's permission group bindings in a single
 * transaction. All existing bindings are removed and replaced with the given
 * set. Pass an empty array to remove all bindings.
 */
export class ReplaceRolePermissionGroupsDto {
  @ApiProperty({ type: Number, isArray: true, description: "Permission group IDs to bind to this role." })
  @IsArray()
  @IsInt({ each: true })
  permissionGroupIds!: number[];
}

/**
 * Request DTO for listing roles with pagination.
 */
export class ListRolesRequestDto extends CommonListRequestDto {}
