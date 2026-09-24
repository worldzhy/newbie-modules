import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one wx page detail row.
 * Mirrors a raw WxPage Mongo document. Note that screen sizes are stored as
 * strings (SDK payload), unlike the web page schema.
 */
export class FrontendMonitorWxPageDetailResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiPropertyOptional({type: String, description: 'Visit time (ISO string)'})
  createTime?: string;

  @ApiProperty({type: String, description: 'Current path'})
  path: string;

  @ApiPropertyOptional({type: Object, additionalProperties: true, description: 'Path params (arbitrary object)'})
  options?: Record<string, any>;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'UV mark'})
  markUv?: string;

  @ApiPropertyOptional({type: String, description: 'Device mark'})
  markDevice?: string;

  @ApiPropertyOptional({type: String, description: 'Network type'})
  net?: string;

  @ApiPropertyOptional({type: String, description: 'User IP'})
  ip?: string;

  @ApiPropertyOptional({type: String, description: 'Country'})
  county?: string;

  @ApiPropertyOptional({type: String, description: 'Province'})
  province?: string;

  @ApiPropertyOptional({type: String, description: 'City'})
  city?: string;

  @ApiPropertyOptional({type: String, description: 'Device brand'})
  brand?: string;

  @ApiPropertyOptional({type: String, description: 'Device model'})
  model?: string;

  @ApiPropertyOptional({type: String, description: 'Screen width (string, SDK payload)'})
  screenWidth?: string;

  @ApiPropertyOptional({type: String, description: 'Screen height (string, SDK payload)'})
  screenHeight?: string;

  @ApiPropertyOptional({type: String, description: 'WeChat language'})
  language?: string;

  @ApiPropertyOptional({type: String, description: 'WeChat version'})
  version?: string;

  @ApiPropertyOptional({type: String, description: 'OS version'})
  system?: string;

  @ApiPropertyOptional({type: String, description: 'Platform'})
  platform?: string;

  @ApiPropertyOptional({type: String, description: 'Base library version'})
  sdkVersion?: string;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;
}

/**
 * Group-by key of one wx page aggregation row.
 * `url` is always present (grouped by `$path`); the dimension fields appear
 * only in getDataGroupBy queries.
 */
export class FrontendMonitorWxPageCountKeyResponseDto {
  @ApiProperty({type: String, description: 'Page path'})
  url: string;

  @ApiPropertyOptional({type: String, description: 'City (getDataGroupBy type=1)'})
  city?: string;

  @ApiPropertyOptional({type: String, description: 'Device brand (getDataGroupBy type=2)'})
  brand?: string;

  @ApiPropertyOptional({type: String, description: 'OS (getDataGroupBy type=3)'})
  system?: string;
}

/**
 * Response DTO for one wx page aggregation row ({_id, count}).
 */
export class FrontendMonitorWxPageCountItemResponseDto {
  @ApiProperty({type: FrontendMonitorWxPageCountKeyResponseDto, description: 'Group-by key'})
  _id: FrontendMonitorWxPageCountKeyResponseDto;

  @ApiProperty({type: Number, description: 'Occurrence count'})
  count: number;
}

/**
 * Paged wrapper for the wx average page list.
 */
export class FrontendMonitorWxPageAverageListResponseDto {
  @ApiProperty({type: FrontendMonitorWxPageCountItemResponseDto, isArray: true, description: 'Page count rows'})
  dataList: FrontendMonitorWxPageCountItemResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}

/**
 * Paged wrapper for the wx single page visit list (raw WxPage documents).
 */
export class FrontendMonitorWxPageVisitListResponseDto {
  @ApiProperty({type: FrontendMonitorWxPageDetailResponseDto, isArray: true, description: 'Page visit rows'})
  dataList: FrontendMonitorWxPageDetailResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}
