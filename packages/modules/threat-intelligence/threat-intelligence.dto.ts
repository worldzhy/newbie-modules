import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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
  category?: ThreatIntelligenceCategory;

  @ApiPropertyOptional({ enum: SEVERITIES })
  severity?: ThreatIntelligenceSeverity;

  @ApiPropertyOptional({ enum: SOURCES })
  source?: ThreatIntelligenceSource;

  @ApiPropertyOptional({ minimum: 1, default: 20 })
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  offset?: number;
}

export class ThreatIntelligenceItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SOURCES }) source!: ThreatIntelligenceSource;
  @ApiProperty({ enum: CATEGORIES }) category!: ThreatIntelligenceCategory;
  @ApiProperty() externalId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional() url?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time" }) publishedAt?: Date | null;
  @ApiProperty({ enum: SEVERITIES }) severity!: ThreatIntelligenceSeverity;
  @ApiProperty({ type: String, isArray: true }) signalTags!: string[];
  @ApiProperty({ type: String, format: "date-time" }) fetchedAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) lastSeenAt!: Date;
}
