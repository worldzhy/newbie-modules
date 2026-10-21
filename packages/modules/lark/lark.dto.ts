import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsObject, IsOptional, IsString, IsNumber } from "class-validator";
import type { LarkCardAction, LarkMessageEvent, LarkWebhookHeader } from "./lark-types";

export class GetChatHistoryRequestDto {
  @ApiProperty({ description: "The ID of the chat group" })
  @IsString()
  @IsNotEmpty()
  chatId!: string;

  @ApiPropertyOptional({ description: "Start time in seconds (timestamp)" })
  @IsString()
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ description: "End time in seconds (timestamp)" })
  @IsString()
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({ description: "Page token for pagination" })
  @IsString()
  @IsOptional()
  pageToken?: string;

  @ApiPropertyOptional({ description: "Page size", default: 20 })
  @IsNumber()
  @IsOptional()
  pageSize?: number;
}

export class SendTextDto {
  @ApiProperty({ description: "The ID of the chat group or user" })
  @IsString()
  @IsNotEmpty()
  receiveId!: string;

  @ApiPropertyOptional({ description: "Type of receive_id (open_id, chat_id, etc.)", default: "chat_id" })
  @IsString()
  @IsOptional()
  receiveIdType?: string;

  @ApiProperty({ description: "Text content to send" })
  @IsString()
  @IsNotEmpty()
  text!: string;
}

export class SendCardDto {
  @ApiProperty({ description: "The ID of the chat group or user" })
  @IsString()
  @IsNotEmpty()
  receiveId!: string;

  @ApiPropertyOptional({ description: "Type of receive_id (open_id, chat_id, etc.)", default: "chat_id" })
  @IsString()
  @IsOptional()
  receiveIdType?: string;

  @ApiProperty({ description: "Card content (JSON object or string)" })
  @IsNotEmpty()
  @IsObject()
  card!: Record<string, unknown>;
}

export class UpdateCardDto {
  @ApiProperty({ description: "The message ID of the card to update" })
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  @ApiProperty({ description: "New card content (JSON object)" })
  @IsNotEmpty()
  @IsObject()
  card!: Record<string, unknown>;
}

export class LarkWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  schema?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  header?: LarkWebhookHeader;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  event?: LarkMessageEvent;

  @ApiPropertyOptional()
  @IsOptional()
  challenge?: string;

  @ApiPropertyOptional()
  @IsOptional()
  type?: string;

  /** Root verification token on legacy (v1) url_verification requests. */
  @ApiPropertyOptional()
  @IsOptional()
  token?: string;

  @ApiPropertyOptional()
  @IsOptional()
  encrypt?: string;

  // For Card Actions
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  action?: LarkCardAction;

  @ApiPropertyOptional()
  @IsOptional()
  open_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  user_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  tenant_key?: string;

  @ApiPropertyOptional()
  @IsOptional()
  open_message_id?: string;
}
