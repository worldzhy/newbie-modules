import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
  ThreatIntelligenceCategory,
  ThreatIntelligenceSeverity,
  ThreatIntelligenceSource,
} from "./threat-intelligence.constants";

const SOURCES = Object.values(THREAT_INTELLIGENCE_SOURCE);
const CATEGORIES = Object.values(THREAT_INTELLIGENCE_CATEGORY);
const SEVERITIES = Object.values(THREAT_INTELLIGENCE_SEVERITY);

export class ListThreatIntelligenceItemsQuery {
  @ApiPropertyOptional({ enum: CATEGORIES })
  @IsOptional()
  @IsEnum(THREAT_INTELLIGENCE_CATEGORY)
  category?: ThreatIntelligenceCategory;

  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsEnum(THREAT_INTELLIGENCE_SEVERITY)
  severity?: ThreatIntelligenceSeverity;

  @ApiPropertyOptional({ enum: SOURCES })
  @IsOptional()
  @IsEnum(THREAT_INTELLIGENCE_SOURCE)
  source?: ThreatIntelligenceSource;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ThreatIntelligenceItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SOURCES }) source!: ThreatIntelligenceSource;
  @ApiProperty({ enum: CATEGORIES }) category!: ThreatIntelligenceCategory;
  @ApiProperty() externalId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) summary?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) url?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) publishedAt?: Date | null;
  @ApiProperty({ enum: SEVERITIES }) severity!: ThreatIntelligenceSeverity;
  @ApiProperty({ type: String, isArray: true }) signalTags!: string[];
  @ApiProperty({ type: String, format: "date-time" }) fetchedAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) lastSeenAt!: Date;
}

export class ListThreatIntelligenceItemsResponseDto {
  @ApiProperty({ type: ThreatIntelligenceItemDto, isArray: true }) items!: ThreatIntelligenceItemDto[];
  @ApiProperty() total!: number;
}
