import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsString, IsOptional, IsNotEmpty} from 'class-validator';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {MessageBotPlatform, MessageBotRecordStatus} from './message-bot.constants';

// Response DTO for a message channel record, mirrors the MessageBotChannel Prisma model.
export class MessageBotChannelDetailResDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  name: string;

  @ApiPropertyOptional({type: String})
  description?: string | null;

  @ApiProperty({type: String})
  webhook: string;

  @ApiProperty({type: String, enum: MessageBotPlatform, description: 'Message platform (Lark / Slack)'})
  platform: string;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiPropertyOptional({type: String})
  groupId?: string | null;
}

// Response DTO for a message delivery record, mirrors the MessageBotRecord Prisma model.
export class MessageBotRecordDetailResDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  channelId: string;

  @ApiProperty({type: String})
  webhook: string;

  @ApiProperty({type: Object, description: 'Raw request payload sent to the webhook'})
  request: Record<string, unknown>;

  @ApiPropertyOptional({type: Object, description: 'Raw response payload received from the webhook'})
  response?: Record<string, unknown> | null;

  @ApiProperty({type: String, enum: MessageBotRecordStatus})
  status: string;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class ListMessageBotChannelsRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  groupId?: string;
}

export class ListMessageBotChannelsResponseDto extends CommonListResponseDto {
  @ApiProperty({type: MessageBotChannelDetailResDto, isArray: true})
  declare records: MessageBotChannelDetailResDto[];
}

export class CreateMessageBotChannelRequestDto {
  @ApiProperty({type: String})
  @IsString()
  name: string;

  @ApiProperty({type: String})
  @IsString()
  webhook: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  groupId?: string;
}

export class UpdateMessageBotChannelRequestDto {
  @ApiProperty({type: String})
  @IsString()
  id: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  webhook?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  groupId?: string;
}

export class ListMessageBotMessagesRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String})
  @IsNotEmpty()
  @IsString()
  channelId: string;
}

export class ListMessageBotMessagesResponseDto extends CommonListResponseDto {
  @ApiProperty({type: MessageBotRecordDetailResDto, isArray: true})
  declare records: MessageBotRecordDetailResDto[];
}
