import {ApiProperty} from '@nestjs/swagger';
import {Type} from 'class-transformer';
import {IsString, IsNumber, IsOptional, IsEnum} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {ShortcutGroupEntity, ShortcutItemEntity} from './shortcut.entity';
import {ShortcutItemType} from '@generated/prisma/client';

export class ShortcutReqBaseDto {
  channelName: string;
}

export class ShortcutTreeRequestDto {
  @ApiProperty({type: Number, required: false})
  @Type(() => Number)
  @IsOptional()
  groupId?: number;
}

export class ShortcutTreeResDto extends ShortcutGroupEntity {
  @ApiProperty({type: ShortcutTreeResDto, isArray: true})
  child: ShortcutTreeResDto[];

  @ApiProperty({type: ShortcutItemEntity, isArray: true})
  items: ShortcutItemEntity[];
}

export class ListShortcutItemsRequestDto extends CommonListRequestDto {
  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  id?: number;

  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  groupId?: number;
}

export class ListShortcutItemsResponseDto extends CommonListResponseDto {
  @ApiProperty({type: ShortcutItemEntity, isArray: true})
  declare records: ShortcutItemEntity[];
}

export class CreateShortcutItemRequestDto {
  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  groupId: number;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  sort: number;

  @ApiProperty({type: String})
  @IsString()
  label: string;

  @ApiProperty({type: String})
  @IsString()
  content: string;

  @ApiProperty({type: String, enum: ShortcutItemType})
  @IsEnum(ShortcutItemType)
  type: ShortcutItemType;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  description: string;
}

export class UpdateShortcutItemRequestDto {
  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({type: String, enum: ShortcutItemType, required: false})
  @IsOptional()
  @IsEnum(ShortcutItemType)
  type?: ShortcutItemType;

  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  sort?: number;

  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  groupId?: number;
}
