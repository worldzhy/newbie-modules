import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsString, IsNumber, IsOptional, IsEnum, ValidateIf, IsUrl } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { ShortcutGroupEntity, ShortcutItemEntity } from "./shortcut.entity";
import { ShortcutItemType } from "@generated/prisma/client";

export class ShortcutReqBaseDto {
  channelName!: string;
}

export class ShortcutTreeRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ type: Number })
  @Type(() => Number)
  @IsOptional()
  groupId?: number;
}

export class ShortcutTreeResDto extends ShortcutGroupEntity {
  @ApiProperty({ type: ShortcutTreeResDto, isArray: true })
  child!: ShortcutTreeResDto[];

  @ApiProperty({ type: ShortcutItemEntity, isArray: true })
  items!: ShortcutItemEntity[];
}

export class ListShortcutItemsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  id?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  groupId?: number;

  @ApiProperty({ type: String })
  @IsString()
  projectId!: string;
}

export class ListShortcutItemsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: ShortcutItemEntity, isArray: true })
  declare records: ShortcutItemEntity[];
}

export class CreateShortcutItemRequestDto {
  @ApiProperty({ type: Number, required: false })
  @IsNumber()
  @IsOptional()
  groupId!: number;

  @ApiProperty({ type: Number, required: false })
  @IsNumber()
  @IsOptional()
  sort!: number;

  @ApiProperty({ type: String })
  @IsString()
  label!: string;

  @ApiProperty({ type: String })
  @IsString()
  // For Link-type shortcuts content is a URL — whitelist http/https so
  // javascript:, data:, file:, etc. cannot be stored and later executed.
  @ValidateIf((o: CreateShortcutItemRequestDto) => o.type === ShortcutItemType.LINK)
  @IsUrl({ protocols: ["http", "https"], require_protocol: true } as const)
  content!: string;

  @ApiProperty({ type: String, enum: ShortcutItemType })
  @IsEnum(ShortcutItemType)
  type!: ShortcutItemType;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  description!: string;
}

export class UpdateShortcutItemRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @ValidateIf((_o, value) => value !== undefined && /^[a-z]+:\/\//i.test(value))
  @IsUrl({ protocols: ["http", "https"], require_protocol: true } as const)
  content?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: String, enum: ShortcutItemType })
  @IsOptional()
  @IsEnum(ShortcutItemType)
  type?: ShortcutItemType;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  sort?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  groupId?: number;
}
