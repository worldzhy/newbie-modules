import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsInt, IsPositive, MaxLength, MinLength } from "class-validator";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";

export class ListTagsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter tags by name (case-insensitive contains)." })
  @IsOptional()
  @IsString()
  name?: string;
}

export class ListTagGroupsRequestDto extends CommonListRequestDto {}

// --- Write DTOs -----------------------------------------------------------
// These replace raw Prisma input types (e.g. Prisma.TagUncheckedCreateInput)
// as controller body parameters. Prisma generated types accept every column
// including system fields (id, createdAt, updatedAt) and nested relation
// creates — the DTOs only expose business fields the caller is allowed to
// set, with explicit validation.

export class CreateTagDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ type: Number, description: "Owning tag group id. Null = ungrouped." })
  @IsOptional()
  @IsInt()
  @IsPositive()
  groupId?: number;
}

export class UpdateTagDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Null moves the tag out of its group." })
  @IsOptional()
  @IsInt()
  @IsPositive()
  groupId?: number | null;
}

export class CreateTagGroupDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateTagGroupDto {
  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;
}
