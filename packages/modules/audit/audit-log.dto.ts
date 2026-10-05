import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";
import { CommonListResponseDto } from "@devbie/newbie/common.dto";

/**
 * Filter and pagination parameters accepted by the audit log query endpoints.
 */
export class AuditLogQueryDto {
  @ApiPropertyOptional({ type: String, description: "Filter by exact event name, e.g. auth.login" })
  @IsOptional()
  @IsString()
  event?: string;

  @ApiPropertyOptional({ type: String, description: "Filter by exact actor ID" })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ type: String, description: "Filter by action, e.g. created / updated / deleted" })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ type: String, description: "Filter by resource type" })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({ type: String, description: "Filter by result: success / failure" })
  @IsOptional()
  @IsString()
  result?: string;

  @ApiPropertyOptional({ type: String, description: "Only include rows created at or after this ISO-8601 instant" })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiPropertyOptional({ type: String, description: "Only include rows created at or before this ISO-8601 instant" })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({ type: String, description: "Case-insensitive substring match on event or resource ID" })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ type: Number, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/**
 * Response DTO for a single AuditLog record.
 */
export class AuditLogResponseDto {
  @ApiProperty({ type: Number })
  id: number;

  @ApiProperty({ type: String })
  event: string;

  @ApiPropertyOptional({ type: String })
  action?: string | null;

  @ApiPropertyOptional({ type: String })
  resourceType?: string | null;

  @ApiPropertyOptional({ type: String })
  resourceId?: string | null;

  @ApiProperty({ type: String })
  result: string;

  @ApiPropertyOptional({ type: Object, description: "Structured event detail payload" })
  detail?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: String })
  actorType?: string | null;

  @ApiPropertyOptional({ type: String })
  actorId?: string | null;

  @ApiPropertyOptional({ type: String })
  organizationId?: string | null;

  @ApiPropertyOptional({ type: String })
  ipAddress?: string | null;

  @ApiPropertyOptional({ type: String })
  userAgent?: string | null;

  @ApiPropertyOptional({ type: String })
  city?: string | null;

  @ApiPropertyOptional({ type: String })
  region?: string | null;

  @ApiPropertyOptional({ type: String })
  timezone?: string | null;

  @ApiPropertyOptional({ type: String })
  countryCode?: string | null;

  @ApiPropertyOptional({ type: String })
  browser?: string | null;

  @ApiPropertyOptional({ type: String })
  operatingSystem?: string | null;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

/**
 * Paginated list response for audit logs.
 */
export class AuditLogListResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: AuditLogResponseDto, isArray: true })
  declare records: AuditLogResponseDto[];
}
