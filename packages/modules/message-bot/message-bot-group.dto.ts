import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNumber, IsOptional } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { MessageBotChannelGroupEntity } from "./message-bot.entity";

export class ListMessageBotChannelGroupsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  id?: string;
}

export class ListMessageBotChannelGroupsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: MessageBotChannelGroupEntity, isArray: true })
  declare records: MessageBotChannelGroupEntity[];
}

export class CreateMessageBotChannelGroupRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  parentId?: string;
}

export class UpdateMessageBotChannelGroupRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ type: Number })
  @IsNumber()
  @IsOptional()
  sort?: number;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  parentId?: string;
}
