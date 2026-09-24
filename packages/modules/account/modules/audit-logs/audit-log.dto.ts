import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {CommonListResponseDto} from '@devbie/newbie/common.dto';

/**
 * Response DTO for a single AuditLog record.
 */
export class AuditLogResponseDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  event: string;

  @ApiProperty({type: String})
  rawEvent: string;

  @ApiPropertyOptional({type: String})
  ipAddress?: string | null;

  @ApiPropertyOptional({type: String})
  userAgent?: string | null;

  @ApiPropertyOptional({type: String})
  city?: string | null;

  @ApiPropertyOptional({type: String})
  region?: string | null;

  @ApiPropertyOptional({type: String})
  timezone?: string | null;

  @ApiPropertyOptional({type: String})
  countryCode?: string | null;

  @ApiPropertyOptional({type: String})
  browser?: string | null;

  @ApiPropertyOptional({type: String})
  operatingSystem?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiPropertyOptional({type: String})
  userId?: string | null;

  @ApiPropertyOptional({type: Number})
  apiKeyId?: number | null;

  @ApiPropertyOptional({type: String})
  organizationId?: string | null;
}

/**
 * Paginated list response for audit logs.
 */
export class AuditLogListResponseDto extends CommonListResponseDto {
  @ApiProperty({type: AuditLogResponseDto, isArray: true})
  declare records: AuditLogResponseDto[];
}
