import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one wx event row.
 * Mirrors a raw WxEvent ClickHouse row (all columns are always present).
 */
export class FrontendMonitorWxEventResponseDto {
  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiProperty({type: String, description: 'Event type'})
  event: string;

  @ApiPropertyOptional({type: String, description: 'Row creation time (ClickHouse DateTime string)'})
  createTime?: string;

  @ApiPropertyOptional({type: String, description: 'Page path'})
  path?: string;

  @ApiPropertyOptional({type: Number, description: 'Duration (ms)'})
  duration?: number;

  @ApiPropertyOptional({type: String, description: 'IP address'})
  ip?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'UV mark'})
  markUv?: string;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;

  @ApiPropertyOptional({type: String, description: 'Network type'})
  net?: string;

  @ApiPropertyOptional({type: String, description: 'Device model'})
  model?: string;

  @ApiPropertyOptional({type: String, description: 'Device brand'})
  brand?: string;

  @ApiPropertyOptional({type: String, description: 'OS version'})
  system?: string;

  @ApiPropertyOptional({type: String, description: 'WeChat language'})
  language?: string;

  @ApiPropertyOptional({type: String, description: 'WeChat version'})
  version?: string;

  @ApiPropertyOptional({type: String, description: 'Base library version'})
  sdkVersion?: string;

  @ApiPropertyOptional({type: String, description: 'Platform'})
  platform?: string;

  @ApiPropertyOptional({type: Number, description: 'Screen width (px)'})
  screenWidth?: number;

  @ApiPropertyOptional({type: Number, description: 'Screen height (px)'})
  screenHeight?: number;
}

/**
 * Paged wrapper for the wx event list.
 */
export class FrontendMonitorWxEventListResponseDto {
  @ApiProperty({type: FrontendMonitorWxEventResponseDto, isArray: true, description: 'Event rows'})
  list: FrontendMonitorWxEventResponseDto[];

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;
}
