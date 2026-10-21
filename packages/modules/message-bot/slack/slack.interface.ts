import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsString, IsOptional, IsBoolean } from "class-validator";
import { SlackWebhookMessageType } from "./slack.constants";

export type SlackMessageBotSendMessageRes = string;

export class SlackMessageBotSendMessageReqBody {
  @ApiProperty({ type: String })
  @IsString()
  [SlackWebhookMessageType.Text]!: string;

  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsObject()
  @IsOptional()
  [SlackWebhookMessageType.Blocks]?: object[];

  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsObject()
  @IsOptional()
  [SlackWebhookMessageType.Attachments]?: object[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  [SlackWebhookMessageType.Thread_ts]?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsBoolean()
  @IsOptional()
  [SlackWebhookMessageType.Mrkdwn]?: boolean;
}
