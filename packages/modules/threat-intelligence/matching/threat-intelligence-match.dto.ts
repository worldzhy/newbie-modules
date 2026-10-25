import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import {
  THREAT_INTELLIGENCE_MATCH_CONFIDENCE,
  THREAT_INTELLIGENCE_MATCH_STATUS,
  THREAT_INTELLIGENCE_MATCH_TYPE,
  ThreatIntelligenceMatchConfidence,
  ThreatIntelligenceMatchStatus,
  ThreatIntelligenceMatchType,
} from "./threat-intelligence-match.constants";

const MATCH_TYPES = Object.values(THREAT_INTELLIGENCE_MATCH_TYPE);
const MATCH_STATUSES = Object.values(THREAT_INTELLIGENCE_MATCH_STATUS);
const CONFIDENCES = Object.values(THREAT_INTELLIGENCE_MATCH_CONFIDENCE);

export class ListThreatIntelligenceMatchesQuery {
  @ApiPropertyOptional({ description: "Host-defined scope discriminator, e.g. project" })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({ description: "Host-defined scope identifier" })
  @IsOptional()
  @IsString()
  scopeId?: string;

  @ApiPropertyOptional({ enum: MATCH_STATUSES })
  @IsOptional()
  @IsEnum(THREAT_INTELLIGENCE_MATCH_STATUS)
  status?: ThreatIntelligenceMatchStatus;

  @ApiPropertyOptional({ enum: CONFIDENCES })
  @IsOptional()
  @IsEnum(THREAT_INTELLIGENCE_MATCH_CONFIDENCE)
  confidence?: ThreatIntelligenceMatchConfidence;

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

export class ThreatIntelligenceMatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty() scopeType!: string;
  @ApiProperty() scopeId!: string;
  @ApiProperty({ enum: MATCH_TYPES }) matchType!: ThreatIntelligenceMatchType;
  @ApiPropertyOptional({ type: String, nullable: true }) matchedEntity?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) evidence?: string | null;
  @ApiProperty({ enum: CONFIDENCES }) confidence!: ThreatIntelligenceMatchConfidence;
  @ApiProperty({ enum: MATCH_STATUSES }) status!: ThreatIntelligenceMatchStatus;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Title of the matched intel item; null when the item was pruned",
  })
  itemTitle?: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) resolvedAt?: Date | null;
}

export class ListThreatIntelligenceMatchesResponseDto {
  @ApiProperty({ type: ThreatIntelligenceMatchDto, isArray: true }) matches!: ThreatIntelligenceMatchDto[];
  @ApiProperty() total!: number;
}

export class UpdateThreatIntelligenceMatchStatusRequest {
  @ApiProperty({ enum: MATCH_STATUSES })
  @IsEnum(THREAT_INTELLIGENCE_MATCH_STATUS)
  status!: ThreatIntelligenceMatchStatus;
}

export class RunThreatIntelligenceMatchResponseDto {
  @ApiProperty({ description: "Items collected from the registered source adapters" })
  collected!: number;

  @ApiProperty({ description: "Recent items evaluated against scope entity sets" })
  evaluated!: number;

  @ApiProperty({ description: "New scope matches created" })
  matched!: number;
}
