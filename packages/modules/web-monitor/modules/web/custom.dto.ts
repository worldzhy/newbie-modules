import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one custom filter definition row.
 * Mirrors a raw WebCustomFilter Mongo document.
 */
export class WebMonitorCustomFilterResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiPropertyOptional({type: String, description: 'Row creation time (ISO string)'})
  createTime?: string;

  @ApiProperty({type: String, description: 'Filter key used in customFilter queries'})
  filterKey: string;

  @ApiProperty({type: String, description: 'Filter description shown in the UI'})
  filterDesc: string;
}

/**
 * Wrapper for the custom filter definition list.
 */
export class WebMonitorCustomFilterListResponseDto {
  @ApiProperty({type: WebMonitorCustomFilterResponseDto, isArray: true, description: 'Filter definition rows'})
  list: WebMonitorCustomFilterResponseDto[];
}

/**
 * Response DTO for one custom metric row.
 * Mirrors a raw WebCustom Mongo document.
 */
export class WebMonitorCustomItemResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiPropertyOptional({type: String, description: 'Row creation time (ISO string)'})
  createTime?: string;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'Page path'})
  path?: string;

  @ApiProperty({type: String, description: 'Custom metric name'})
  customName: string;

  @ApiPropertyOptional({type: String, description: 'Custom metric payload (stringified object)'})
  customContent?: string;

  @ApiPropertyOptional({type: Object, additionalProperties: true, description: 'Custom filter key/value pairs'})
  customFilter?: Record<string, any>;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;
}

/**
 * Paged wrapper for the custom metric list.
 */
export class WebMonitorCustomAverageListResponseDto {
  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: WebMonitorCustomItemResponseDto, isArray: true, description: 'Custom metric rows'})
  dataList: WebMonitorCustomItemResponseDto[];

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}
