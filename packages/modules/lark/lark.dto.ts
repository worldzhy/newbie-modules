import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, IsNumber } from "class-validator";
import type { LarkCardAction, LarkMessageEvent, LarkWebhookHeader } from "./lark-types";

export class GetChatHistoryDto {
  @ApiProperty({ description: "The ID of the chat group", required: true })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ description: "Start time in seconds (timestamp)", required: false })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiProperty({ description: "End time in seconds (timestamp)", required: false })
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiProperty({ description: "Page token for pagination", required: false })
  @IsString()
  @IsOptional()
  pageToken?: string;

  @ApiProperty({ description: "Page size", required: false, default: 20 })
  @IsNumber()
  @IsOptional()
  pageSize?: number;
}

export class SendTextDto {
  @ApiProperty({ description: "The ID of the chat group or user", required: true })
  @IsString()
  @IsNotEmpty()
  receiveId: string;

  @ApiProperty({ description: "Type of receive_id (open_id, chat_id, etc.)", default: "chat_id" })
  @IsString()
  @IsOptional()
  receiveIdType?: string;

  @ApiProperty({ description: "Text content to send" })
  @IsString()
  @IsNotEmpty()
  text: string;
}

export class SendCardDto {
  @ApiProperty({ description: "The ID of the chat group or user", required: true })
  @IsString()
  @IsNotEmpty()
  receiveId: string;

  @ApiProperty({ description: "Type of receive_id (open_id, chat_id, etc.)", default: "chat_id" })
  @IsString()
  @IsOptional()
  receiveIdType?: string;

  @ApiProperty({ description: "Card content (JSON object or string)" })
  @IsNotEmpty()
  card: Record<string, unknown>;
}

export class UpdateCardDto {
  @ApiProperty({ description: "The message ID of the card to update", required: true })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ description: "New card content (JSON object)" })
  @IsNotEmpty()
  card: Record<string, unknown>;
}

export class LarkWebhookDto {
  @ApiProperty()
  @IsOptional()
  schema?: string;

  @ApiProperty()
  @IsOptional()
  header?: LarkWebhookHeader;

  @ApiProperty()
  @IsOptional()
  event?: LarkMessageEvent;

  @ApiProperty()
  @IsOptional()
  challenge?: string;

  @ApiProperty()
  @IsOptional()
  type?: string;

  @ApiProperty()
  @IsOptional()
  encrypt?: string;

  // For Card Actions
  @ApiProperty()
  @IsOptional()
  action?: LarkCardAction;

  @ApiProperty()
  @IsOptional()
  open_id?: string;

  @ApiProperty()
  @IsOptional()
  user_id?: string;

  @ApiProperty()
  @IsOptional()
  tenant_key?: string;

  @ApiProperty()
  @IsOptional()
  open_message_id?: string;
}
