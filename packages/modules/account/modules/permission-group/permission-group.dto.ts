import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Length } from "class-validator";

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

  @ApiProperty({ type: String, description: "Navigation group: top-nav | platform | hidden" })
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  navGroup!: string;

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

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsNotEmpty()
  @Length(1, 64)
  @IsOptional()
  navGroup?: string;

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

  @ApiProperty({ type: String })
  navGroup!: string;

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
