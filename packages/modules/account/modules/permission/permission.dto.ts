import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * Request DTO for creating a permission.
 * Mirrors the writable scalar columns of the Permission model.
 */
export class CreatePermissionDto {
  @ApiProperty({ enum: PermissionAction, description: "The action allowed by this rule." })
  @IsEnum(PermissionAction)
  action!: PermissionAction;

  @ApiProperty({ type: String, description: "The resource (Prisma model name) the rule applies to." })
  @IsString()
  @IsNotEmpty()
  resource!: string;

  @ApiPropertyOptional({ type: String, description: "Scopes the rule to a specific trusted user id." })
  @IsUUID()
  @IsOptional()
  trustedUserId?: string;

  @ApiPropertyOptional({ type: Number, description: "Scopes the rule to a specific role id." })
  @IsInt()
  @IsOptional()
  roleId?: number;
}

/**
 * Request DTO for updating a permission. All fields are optional.
 */
export class UpdatePermissionDto {
  @ApiPropertyOptional({ enum: PermissionAction })
  @IsEnum(PermissionAction)
  @IsOptional()
  action?: PermissionAction;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  resource?: string;

  @ApiPropertyOptional({ type: String })
  @IsUUID()
  @IsOptional()
  trustedUserId?: string;

  @ApiPropertyOptional({ type: Number })
  @IsInt()
  @IsOptional()
  roleId?: number;
}

/**
 * Response DTO for a single Permission record.
 */
export class PermissionResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ enum: PermissionAction })
  action!: PermissionAction;

  @ApiProperty({ type: String })
  resource!: string;

  @ApiPropertyOptional({ type: String })
  trustedUserId?: string | null;

  @ApiPropertyOptional({ type: Number })
  roleId?: number | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

/**
 * Paginated list response for permissions.
 */
export class ListPermissionsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: PermissionResponseDto, isArray: true })
  declare records: PermissionResponseDto[];
}

/**
 * Request DTO for listing permissions with pagination and optional resource filter.
 */
export class ListPermissionsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter permissions by resource name." })
  @IsOptional()
  @IsString()
  resource?: string;
}
