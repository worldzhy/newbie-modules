import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one PV/UV/IP history row.
 * Mirrors a raw WebPvuvip Mongo document (returned as-is by the
 * history endpoints) plus the extra `num` field injected by the service.
 */
export class WebMonitorPvUvIpResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiProperty({type: String, description: 'App ID (system identifier)'})
  appId: string;

  @ApiProperty({type: Number, description: 'PV count'})
  pv: number;

  @ApiProperty({type: Number, description: 'UV count'})
  uv: number;

  @ApiProperty({type: Number, description: 'IP count'})
  ip: number;

  @ApiProperty({type: Number, description: 'AJAX request count'})
  ajax: number;

  @ApiPropertyOptional({type: String, description: 'Bounce rate'})
  bounce?: string;

  @ApiPropertyOptional({type: Number, description: 'Average visit depth'})
  depth?: number;

  @ApiProperty({type: Number, description: 'Total traffic cost'})
  flow: number;

  @ApiProperty({type: Number, description: 'Data granularity: 1 per-minute, 2 per-day'})
  type: number;

  @ApiProperty({type: String, description: 'Row creation time (ISO string)'})
  createTime: string;

  @ApiPropertyOptional({type: Number, description: 'Report count of the day'})
  num?: number;
}
