import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  THREAT_INTEL_CATEGORY,
  THREAT_INTEL_SEVERITY,
  THREAT_INTEL_SOURCE,
  ThreatIntelCategory,
  ThreatIntelSeverity,
  ThreatIntelSource,
} from "./threat-intel.constants";

const SOURCES = Object.values(THREAT_INTEL_SOURCE);
const CATEGORIES = Object.values(THREAT_INTEL_CATEGORY);
const SEVERITIES = Object.values(THREAT_INTEL_SEVERITY);

export class ListThreatIntelItemsQuery {
  @ApiPropertyOptional({ enum: CATEGORIES })
  category?: ThreatIntelCategory;

  @ApiPropertyOptional({ enum: SEVERITIES })
  severity?: ThreatIntelSeverity;

  @ApiPropertyOptional({ enum: SOURCES })
  source?: ThreatIntelSource;

  @ApiPropertyOptional({ minimum: 1, default: 20 })
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  offset?: number;
}

export class ThreatIntelItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: SOURCES }) source!: ThreatIntelSource;
  @ApiProperty({ enum: CATEGORIES }) category!: ThreatIntelCategory;
  @ApiProperty() externalId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional() url?: string | null;
  @ApiPropertyOptional({ type: String, format: "date-time" }) publishedAt?: Date | null;
  @ApiProperty({ enum: SEVERITIES }) severity!: ThreatIntelSeverity;
  @ApiProperty({ type: String, isArray: true }) signalTags!: string[];
  @ApiProperty({ type: String, format: "date-time" }) fetchedAt!: Date;
  @ApiProperty({ type: String, format: "date-time" }) lastSeenAt!: Date;
}
