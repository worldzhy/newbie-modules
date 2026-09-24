import {ApiProperty} from '@nestjs/swagger';
import {Type} from 'class-transformer';
import {IsString, IsNumber, IsOptional} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {ShortcutGroupEntity} from './shortcut.entity';

export class ShortcutReqBaseDto {
  channelName: string;
}

export class ListShortcutGroupsRequestDto extends CommonListRequestDto {
  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  id?: number;
}
export class ListShortcutGroupsResponseDto extends CommonListResponseDto {
  @ApiProperty({type: ShortcutGroupEntity, isArray: true})
  declare records: ShortcutGroupEntity[];
}

export class CreateShortcutGroupRequestDto {
  @ApiProperty({type: String})
  @IsString()
  name: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  parentId?: number;
}

export class UpdateShortcutGroupRequestDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiProperty({type: Number, required: false})
  @IsNumber()
  @IsOptional()
  parentId?: number;
}
