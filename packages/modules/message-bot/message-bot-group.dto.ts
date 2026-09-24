import {ApiProperty} from '@nestjs/swagger';
import {IsString, IsNumber, IsOptional} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {MessageBotChannelGroupEntity} from './message-bot.entity';

export class ListMessageBotChannelGroupsRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  id?: string;
}

export class ListMessageBotChannelGroupsResponseDto extends CommonListResponseDto {
  @ApiProperty({type: MessageBotChannelGroupEntity, isArray: true})
  declare records: MessageBotChannelGroupEntity[];
}

export class CreateMessageBotChannelGroupRequestDto {
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

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  parentId?: string;
}

export class UpdateMessageBotChannelGroupRequestDto {
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

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  parentId?: string;
}
