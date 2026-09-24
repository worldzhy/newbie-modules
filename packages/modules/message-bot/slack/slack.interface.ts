import {ApiProperty} from '@nestjs/swagger';
import {IsObject, IsString, IsOptional, IsBoolean} from 'class-validator';
import {SlackWebhookMessageType} from './slack.constants';

export type SlackMessageBotSendMessageRes = string;

export class SlackMessageBotSendMessageReqBody {
  @ApiProperty({type: String})
  @IsString()
  [SlackWebhookMessageType.Text]: string;

  @ApiProperty({type: Object, isArray: true, required: false})
  @IsObject()
  @IsOptional()
  [SlackWebhookMessageType.Blocks]?: object[];

  @ApiProperty({type: Object, isArray: true, required: false})
  @IsObject()
  @IsOptional()
  [SlackWebhookMessageType.Attachments]?: object[];

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  [SlackWebhookMessageType.Thread_ts]?: string;

  @ApiProperty({type: Boolean, required: false})
  @IsBoolean()
  @IsOptional()
  [SlackWebhookMessageType.Mrkdwn]?: boolean;
}
