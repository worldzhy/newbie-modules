import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsString, IsOptional } from "class-validator";
import { LarkWebhookMessageType } from "./lark.constants";

// Internal type for the raw Lark webhook response, not exposed through any controller.
export class LarkMessageBotSendMessageRes {
  code!: number;

  msg!: string;

  data?: unknown;
}

export class LarkMessageBotSendMessageReqBody {
  @ApiProperty({ type: String, enum: LarkWebhookMessageType })
  @IsString()
  msg_type!: string;

  @ApiPropertyOptional({ type: Object })
  @IsObject()
  @IsOptional()
  content?: object;

  @ApiPropertyOptional({ type: Object, description: "Card structure for interactive messages" })
  @IsObject()
  @IsOptional()
  card?: object;

  @ApiPropertyOptional({
    type: String,
    description: "Unix timestamp in seconds, required when signature verification is enabled",
  })
  @IsString()
  @IsOptional()
  timestamp?: string;

  @ApiPropertyOptional({
    type: String,
    description: "HMAC-SHA256 signature, required when signature verification is enabled",
  })
  @IsString()
  @IsOptional()
  sign?: string;
}
