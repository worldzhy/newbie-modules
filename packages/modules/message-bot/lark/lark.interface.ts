import {ApiProperty} from '@nestjs/swagger';
import {IsObject, IsString, IsOptional} from 'class-validator';
import {LarkWebhookMessageType} from './lark.constants';

// Internal type for the raw Lark webhook response, not exposed through any controller.
export class LarkMessageBotSendMessageRes {
  code: number;

  msg: string;

  data?: unknown;
}

export class LarkMessageBotSendMessageReqBody {
  @ApiProperty({type: String, enum: LarkWebhookMessageType})
  @IsString()
  msg_type: string;

  @ApiProperty({type: Object, required: false})
  @IsObject()
  @IsOptional()
  content?: object;

  @ApiProperty({type: Object, required: false, description: 'Card structure for interactive messages'})
  @IsObject()
  @IsOptional()
  card?: object;

  @ApiProperty({
    type: String,
    required: false,
    description: 'Unix timestamp in seconds, required when signature verification is enabled',
  })
  @IsString()
  @IsOptional()
  timestamp?: string;

  @ApiProperty({
    type: String,
    required: false,
    description: 'HMAC-SHA256 signature, required when signature verification is enabled',
  })
  @IsString()
  @IsOptional()
  sign?: string;
}
