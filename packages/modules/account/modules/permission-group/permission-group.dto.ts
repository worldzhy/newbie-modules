import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { NavPlacement, PermissionAction } from "@generated/prisma/client";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreatePermissionGroupDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ type: String, description: "Frontend route path, e.g. /iam" })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  routePath!: string;

  // eslint-disable-next-line @darraghor/nestjs-typed/all-properties-have-explicit-defined -- false positive on pure-required DTO
  @ApiProperty({ enum: NavPlacement, description: "Where the group surfaces in the application chrome." })
  @IsEnum(NavPlacement)
  navPlacement!: NavPlacement;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description: "Header nav position (1-based). Omit to append after the current last header entry.",
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  navOrder?: number;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  navLabel!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  navIcon?: string;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @IsBoolean()
  @IsOptional()
  isBuiltin?: boolean;
}

export class UpdatePermissionGroupDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  @IsOptional()
  routePath?: string;

  @ApiPropertyOptional({ enum: NavPlacement })
  @IsEnum(NavPlacement)
  @IsOptional()
  navPlacement?: NavPlacement;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  navOrder?: number;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  @IsOptional()
  navLabel?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  navIcon?: string;
}

export class PermissionGroupResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  description?: string | null;

  @ApiProperty({ type: String })
  routePath!: string;

  @ApiProperty({ enum: NavPlacement })
  navPlacement!: NavPlacement;

  @ApiProperty({ type: Number })
  navOrder!: number;

  @ApiProperty({ type: String })
  navLabel!: string;

  @ApiPropertyOptional({ type: String })
  navIcon?: string | null;

  @ApiProperty({ type: Boolean })
  isBuiltin!: boolean;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class PermissionGroupPermissionResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: Number })
  permissionGroupId!: number;

  @ApiProperty({ enum: PermissionAction })
  action!: PermissionAction;

  @ApiProperty({ type: String })
  resource!: string;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class PermissionGroupDetailResponseDto extends PermissionGroupResponseDto {
  @ApiProperty({ type: PermissionGroupPermissionResponseDto, isArray: true })
  permissions!: PermissionGroupPermissionResponseDto[];
}

export class AddPermissionGroupPermissionDto {
  // eslint-disable-next-line @darraghor/nestjs-typed/all-properties-have-explicit-defined -- false positive on pure-required DTO
  @ApiProperty({ enum: PermissionAction })
  @IsEnum(PermissionAction)
  action!: PermissionAction;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  resource!: string;
}

export class ReplacePermissionGroupPermissionsDto {
  @ApiProperty({
    type: AddPermissionGroupPermissionDto,
    isArray: true,
    description: "Full replacement set (transactional).",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddPermissionGroupPermissionDto)
  permissions!: AddPermissionGroupPermissionDto[];
}

/**
 * Full replacement of header nav ordering: the array position becomes
 * navOrder (1-based) for every listed group, inside one transaction.
 */
export class ReorderPermissionGroupsNavOrderDto {
  @ApiProperty({
    type: Number,
    isArray: true,
    description: "PermissionGroup ids in the desired order (index 0 becomes navOrder 1).",
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  ids!: number[];
}

export class ListPermissionGroupsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter by permission group name." })
  @IsOptional()
  @IsString()
  name?: string;
}

export class ListPermissionGroupsResponseDto {
  @ApiProperty({ type: Number })
  total!: number;

  @ApiProperty({ type: Number })
  page!: number;

  @ApiProperty({ type: Number })
  pageSize!: number;

  @ApiProperty({ type: PermissionGroupResponseDto, isArray: true })
  records!: PermissionGroupResponseDto[];
}
