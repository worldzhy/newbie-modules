import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

export class EventDescriptionDto {
  @ApiProperty({ description: "Event key, e.g. url-check.down" })
  key!: string;

  @ApiProperty({ description: "Human-readable display name declared by the emitter", example: "URL Check Down" })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  payloadExample?: unknown;

  @ApiProperty({ description: "Whether a module declared this event at startup" })
  declared!: boolean;

  @ApiProperty({ description: "Number of listeners currently subscribed to this event" })
  listenerCount!: number;

  @ApiProperty({ description: "Total recorded emissions of this event" })
  emissionCount!: number;

  @ApiProperty({ nullable: true, type: String, format: "date-time" })
  lastEmittedAt!: Date | null;
}

export class EventEmissionDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  eventKey!: string;

  @ApiPropertyOptional({ type: Object, nullable: true })
  payload?: unknown;

  @ApiProperty({ description: "Number of listeners subscribed when this emission fired" })
  listenerCount!: number;

  @ApiProperty()
  emittedAt!: Date;
}

export class ListEventEmissionsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: "Filter by exact event key" })
  @IsOptional()
  @IsString()
  eventKey?: string;
}

export class ListEventEmissionsResponseDto extends CommonListResponseDto<EventEmissionDto> {}
