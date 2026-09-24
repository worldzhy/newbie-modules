import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one resource performance item of a page detail.
 * The Mongo schema declares `resourceList` as an untyped array; the SDK stores
 * `{name, type, duration, bodySize}` records where `duration` is a numeric string.
 */
export class FrontendMonitorPageResourceItemResponseDto {
  @ApiPropertyOptional({type: String, description: 'Resource name (URL)'})
  name?: string;

  @ApiPropertyOptional({type: String, description: 'Resource type (script / css / img / xmlhttprequest ...)'})
  type?: string;

  @ApiPropertyOptional({type: String, description: 'Load duration (numeric string, ms)'})
  duration?: string;

  @ApiPropertyOptional({type: Number, description: 'Resource size (bytes)'})
  bodySize?: number;
}

/**
 * Response DTO for one page detail row.
 * Mirrors a raw WebPage Mongo document.
 */
export class FrontendMonitorPageDetailResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiPropertyOptional({type: String, description: 'Visit time (ISO string)'})
  createTime?: string;

  @ApiProperty({type: String, description: 'URL domain'})
  url: string;

  @ApiPropertyOptional({type: String, description: 'Full URL'})
  fullUrl?: string;

  @ApiPropertyOptional({type: String, description: 'Referrer URL'})
  preUrl?: string;

  @ApiPropertyOptional({type: Number, description: 'Speed type: 1 normal, 2 slow'})
  speedType?: number;

  @ApiPropertyOptional({type: Boolean, description: 'Whether this is the first visit in the session'})
  isFirstIn?: boolean;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: Number, description: 'Full load time (ms)'})
  loadTime?: number;

  @ApiPropertyOptional({type: Number, description: 'DNS time (ms)'})
  dnsTime?: number;

  @ApiPropertyOptional({type: Number, description: 'TCP connect time (ms)'})
  tcpTime?: number;

  @ApiPropertyOptional({type: Number, description: 'DOM build time (ms)'})
  domTime?: number;

  @ApiPropertyOptional({
    type: FrontendMonitorPageResourceItemResponseDto,
    isArray: true,
    description: 'Resource performance list',
  })
  resourceList?: FrontendMonitorPageResourceItemResponseDto[];

  @ApiPropertyOptional({type: Number, description: 'Total resource size (bytes)'})
  totalResSize?: number;

  @ApiPropertyOptional({type: Number, description: 'First paint time (ms)'})
  whiteTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Redirect time (ms)'})
  redirectTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Unload time (ms)'})
  unloadTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Request time (ms)'})
  requestTime?: number;

  @ApiPropertyOptional({type: Number, description: 'DOM parsing time (ms)'})
  analysisDomTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Page ready time (ms)'})
  readyTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Screen width (px)'})
  screenWidth?: number;

  @ApiPropertyOptional({type: Number, description: 'Screen height (px)'})
  screenHeight?: number;
}

/**
 * Group-by key of one page average row.
 */
export class FrontendMonitorPageAverageKeyResponseDto {
  @ApiProperty({type: String, description: 'URL domain'})
  url: string;
}

/**
 * Response DTO for one page average row (grouped by url).
 * Aggregated fields are optional: they only appear in first-in/visit mode.
 */
export class FrontendMonitorPageAverageItemResponseDto {
  @ApiProperty({type: FrontendMonitorPageAverageKeyResponseDto, description: 'Group-by key {url}'})
  _id: FrontendMonitorPageAverageKeyResponseDto;

  @ApiProperty({type: Number, description: 'Visit count'})
  count: number;

  @ApiPropertyOptional({type: Number, description: 'Average full load time (ms)'})
  loadTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average DNS time (ms)'})
  dnsTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average TCP connect time (ms)'})
  tcpTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average DOM build time (ms)'})
  domTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average first paint time (ms)'})
  whiteTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average request time (ms)'})
  requestTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average DOM parsing time (ms)'})
  analysisDomTime?: number;

  @ApiPropertyOptional({type: Number, description: 'Average page ready time (ms)'})
  readyTime?: number;
}

/**
 * Paged wrapper for the average page performance list.
 */
export class FrontendMonitorPageAverageListResponseDto {
  @ApiProperty({type: FrontendMonitorPageAverageItemResponseDto, isArray: true, description: 'Page average rows'})
  dataList: FrontendMonitorPageAverageItemResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}

/**
 * Response DTO for one real-time page performance interval bucket.
 * Returned as a bare array by getRealTimeAveragePageList.
 */
export class FrontendMonitorRealTimePageItemResponseDto {
  @ApiProperty({type: String, description: 'Interval start (yyyy/MM/dd hh:mm)'})
  beginTime: string;

  @ApiProperty({type: String, description: 'Interval end (yyyy/MM/dd hh:mm)'})
  endTime: string;

  @ApiProperty({type: Number, description: 'Visit count in the interval'})
  count: number;

  @ApiProperty({type: Number, description: 'Average DNS time (ms)'})
  dnsTime: number;

  @ApiProperty({type: Number, description: 'Average full load time (ms)'})
  loadTime: number;

  @ApiProperty({type: Number, description: 'Average request time (ms)'})
  requestTime: number;

  @ApiProperty({type: Number, description: 'Average TCP connect time (ms)'})
  tcpTime: number;

  @ApiProperty({type: Number, description: 'Average first paint time (ms)'})
  whiteTime: number;
}

/**
 * Paged wrapper for the single page visit list (raw WebPage documents).
 */
export class FrontendMonitorPageVisitListResponseDto {
  @ApiProperty({type: FrontendMonitorPageDetailResponseDto, isArray: true, description: 'Page visit rows'})
  dataList: FrontendMonitorPageDetailResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}
