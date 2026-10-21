import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsString, IsNumber, IsOptional } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { ShortcutGroupEntity } from "./shortcut.entity";

export class ShortcutReqBaseDto {
  channelName!: string;
}

export class ListShortcutGroupsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  id?: number;
}
export class ListShortcutGroupsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: ShortcutGroupEntity, isArray: true })
  declare records: ShortcutGroupEntity[];
}

export class CreateShortcutGroupRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  parentId?: number;
}

export class UpdateShortcutGroupRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  parentId?: number;
}
