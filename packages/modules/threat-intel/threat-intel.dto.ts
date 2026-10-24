import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  THREAT_INTEL_CATEGORY,
  THREAT_INTEL_CONFIDENCE,
  THREAT_INTEL_MATCH_STATUS,
  THREAT_INTEL_MATCH_TYPE,
  THREAT_INTEL_SEVERITY,
  THREAT_INTEL_SOURCE,
  ThreatIntelCategory,
  ThreatIntelConfidence,
  ThreatIntelMatchStatus,
  ThreatIntelMatchType,
  ThreatIntelSeverity,
  ThreatIntelSource,
} from "./threat-intel.constants";

const SOURCES = Object.values(THREAT_INTEL_SOURCE);
const CATEGORIES = Object.values(THREAT_INTEL_CATEGORY);
const SEVERITIES = Object.values(THREAT_INTEL_SEVERITY);
const MATCH_TYPES = Object.values(THREAT_INTEL_MATCH_TYPE);
const MATCH_STATUSES = Object.values(THREAT_INTEL_MATCH_STATUS);
const CONFIDENCES = Object.values(THREAT_INTEL_CONFIDENCE);

export class ListThreatIntelItemsQuery {
  @ApiPropertyOptional({ enum: CATEGORIES })
  category?: ThreatIntelCategory;

  @ApiPropertyOptional({ enum: SEVERITIES })
  severity?: ThreatIntelSeverity;

  @ApiPropertyOptional({ enum: SOURCES })
  source?: ThreatIntelSource;

  @ApiPropertyOptional({ description: "Only items with at least one match against a project.", default: false })
  matchedOnly?: boolean;

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

export class ListThreatIntelMatchesQuery {
  @ApiPropertyOptional() projectId?: string;
  @ApiPropertyOptional({ enum: MATCH_STATUSES }) status?: ThreatIntelMatchStatus;
  @ApiPropertyOptional({ enum: CONFIDENCES }) confidence?: ThreatIntelConfidence;
  @ApiPropertyOptional({ minimum: 1, default: 20 }) limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) offset?: number;
}

export class ThreatIntelMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() projectId!: string;
  @ApiPropertyOptional() applicationId?: string | null;
  @ApiProperty({ enum: MATCH_TYPES }) matchType!: ThreatIntelMatchType;
  @ApiPropertyOptional() matchedEntity?: string | null;
  @ApiPropertyOptional() evidence?: string | null;
  @ApiProperty({ enum: CONFIDENCES }) confidence!: ThreatIntelConfidence;
  @ApiProperty({ enum: MATCH_STATUSES }) status!: ThreatIntelMatchStatus;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
}

export class UpdateMatchStatusRequest {
  @ApiProperty({ enum: MATCH_STATUSES }) status!: ThreatIntelMatchStatus;
}
