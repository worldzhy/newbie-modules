import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one full AJAX log row.
 * Mirrors a raw WebAjax ClickHouse row.
 */
export class WebMonitorAjaxRowResponseDto {
  @ApiPropertyOptional({type: String, description: 'Row creation time (ClickHouse DateTime string)'})
  createTime?: string;

  @ApiProperty({type: String, description: 'AJAX URL'})
  url: string;

  @ApiProperty({type: String, description: 'Request method'})
  method: string;

  @ApiProperty({type: Number, description: 'Response time (ms)'})
  duration: number;

  @ApiProperty({type: Number, description: 'Response size (bytes)'})
  bodySize: number;

  @ApiPropertyOptional({type: String, description: 'Request body options'})
  options?: string;

  @ApiPropertyOptional({type: String, description: 'Query params'})
  query?: string;

  @ApiPropertyOptional({type: String, description: 'Full URL'})
  fullUrl?: string;

  @ApiPropertyOptional({type: String, description: 'Calling page URL'})
  callUrl?: string;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;

  @ApiPropertyOptional({type: String, description: 'Server trace ID'})
  traceId?: string;
}

/**
 * Group-by key of one AJAX average row.
 */
export class WebMonitorAjaxAvgKeyResponseDto {
  @ApiProperty({type: String, description: 'Request method'})
  method: string;

  @ApiProperty({type: String, description: 'AJAX URL'})
  url: string;
}

/**
 * Response DTO for one AJAX average row (grouped by url + method).
 */
export class WebMonitorAjaxAvgItemResponseDto {
  @ApiProperty({type: String, description: 'AJAX URL'})
  url: string;

  @ApiProperty({type: String, description: 'Request method'})
  method: string;

  @ApiProperty({type: Number, description: 'Occurrence count'})
  count: number;

  @ApiProperty({type: Number, description: 'Average response time (ms, floored)'})
  durationAvg: number;

  @ApiProperty({type: Number, description: 'Average response size (bytes, floored)'})
  bodySize: number;

  @ApiProperty({type: WebMonitorAjaxAvgKeyResponseDto, description: 'Group-by key {method, url}'})
  _id: WebMonitorAjaxAvgKeyResponseDto;

  @ApiProperty({type: Number, description: 'Alias of durationAvg kept for legacy consumers'})
  duration: number;
}

/**
 * Paged wrapper for the AJAX average list (also used by getPageAjaxsAvg).
 * Shared by the web and wx ajax endpoints.
 */
export class WebMonitorAjaxAverageListResponseDto {
  @ApiProperty({type: WebMonitorAjaxAvgItemResponseDto, isArray: true, description: 'AJAX average rows'})
  dataList: WebMonitorAjaxAvgItemResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}

/**
 * Paged wrapper for the single AJAX log list (full rows).
 * Shared by the web and wx ajax endpoints.
 */
export class WebMonitorAjaxOneListResponseDto {
  @ApiProperty({type: WebMonitorAjaxRowResponseDto, isArray: true, description: 'AJAX log rows'})
  dataList: WebMonitorAjaxRowResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}

/**
 * Wrapper for the marked-user AJAX list (full rows, time ascending).
 * Shared by the web and wx ajax endpoints.
 */
export class WebMonitorAjaxMarkUserListResponseDto {
  @ApiProperty({type: WebMonitorAjaxRowResponseDto, isArray: true, description: 'AJAX log rows'})
  list: WebMonitorAjaxRowResponseDto[];
}
