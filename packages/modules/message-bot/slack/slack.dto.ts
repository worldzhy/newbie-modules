import {ApiProperty} from '@nestjs/swagger';
import {IsString, ValidateNested, IsDefined} from 'class-validator';
import {Type} from 'class-transformer';
import {SlackMessageBotSendMessageReqBody} from './slack.interface';

export class SendSlackMessageRequestDto {
  @ApiProperty({type: String})
  @IsString()
  channelId: string;

  @ApiProperty({type: SlackMessageBotSendMessageReqBody})
  @Type(() => SlackMessageBotSendMessageReqBody)
  @ValidateNested()
  @IsDefined()
  body: SlackMessageBotSendMessageReqBody;
}

export class SendSlackTextMessageRequestDto {
  @ApiProperty({type: String})
  @IsString()
  channelId: string;

  @ApiProperty({type: String})
  @IsString()
  text: string;
}

export class SendSlackMessageResponseDto {
  @ApiProperty({type: String, required: false})
  res?: string;

  @ApiProperty({type: Object, required: false})
  error?: object;
}
