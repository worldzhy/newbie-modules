import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one error row.
 *
 * Covers both shapes returned by the web/wx error services:
 * - Real-time / detail mode: a full ClickHouse row (WebError or WxError table).
 * - Grouped mode: a partial aggregation row (group-by keys + lastCreateTime /
 *   count / userNum / lastMsg), where `_id` carries a shallow copy of the row itself.
 *
 * Web and Wx tables differ slightly (web has resourceUrl/target/api/fullUrl/url,
 * wx has errorType/fullName/path), so every column is optional here.
 * Self-referencing `_id` uses a thunk type to avoid TDZ issues in decorators.
 */
export class FrontendMonitorErrorItemResponseDto {
  @ApiPropertyOptional({
    type: () => FrontendMonitorErrorItemResponseDto,
    description: 'Shallow copy of the row itself (grouped mode) or the full row (detail mode)',
  })
  _id?: FrontendMonitorErrorItemResponseDto;

  @ApiPropertyOptional({type: String, description: 'Row creation time (ClickHouse DateTime string)'})
  createTime?: string;

  @ApiPropertyOptional({type: String, description: 'Error message'})
  msg?: string;

  @ApiPropertyOptional({type: String, description: 'Error stack trace'})
  stack?: string;

  // ---- Group-by keys (present depending on the `type` query param) ----
  @ApiPropertyOptional({type: String, description: 'Error resource URL (web group-by key)'})
  resourceUrl?: string;

  @ApiPropertyOptional({type: String, description: 'Error resource URL / JS error type (group-by key)'})
  name?: string;

  @ApiPropertyOptional({type: String, description: 'Error category (group-by key)'})
  type?: string;

  @ApiPropertyOptional({type: String, description: 'HTTP status (group-by key)'})
  status?: string;

  @ApiPropertyOptional({type: String, description: 'JS error type (wx group-by key)'})
  errorType?: string;

  // ---- Grouped-mode aggregation extras ----
  @ApiPropertyOptional({type: String, description: 'Latest occurrence time in the group'})
  lastCreateTime?: string;

  @ApiPropertyOptional({type: Number, description: 'Occurrence count in the group'})
  count?: number;

  @ApiPropertyOptional({type: Number, description: 'Distinct affected users in the group'})
  userNum?: number;

  @ApiPropertyOptional({type: String, description: 'Latest error message in the group'})
  lastMsg?: string;

  // ---- Full-row columns (WebError / WxError tables) ----
  @ApiPropertyOptional({type: String, description: 'Resource element type (web only)'})
  target?: string;

  @ApiPropertyOptional({type: String, description: 'Source API (web only)'})
  api?: string;

  @ApiPropertyOptional({type: String, description: 'Column number'})
  col?: string;

  @ApiPropertyOptional({type: String, description: 'Line number'})
  line?: string;

  @ApiPropertyOptional({type: String, description: 'HTTP query params'})
  query?: string;

  @ApiPropertyOptional({type: String, description: 'POST body params'})
  options?: string;

  @ApiPropertyOptional({type: String, description: 'Request method'})
  method?: string;

  @ApiPropertyOptional({type: String, description: 'Full error resource URL (wx only)'})
  fullName?: string;

  @ApiPropertyOptional({type: String, description: 'Full error resource URL (web only)'})
  fullUrl?: string;

  @ApiPropertyOptional({type: String, description: 'Page URL (web only)'})
  url?: string;

  @ApiPropertyOptional({type: String, description: 'Page path (wx only)'})
  path?: string;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;

  @ApiPropertyOptional({type: String, description: 'Trace ID'})
  traceId?: string;
}

/**
 * Paged wrapper for the error list (average / grouped or real-time mode).
 * Shared by the web and wx error endpoints.
 */
export class FrontendMonitorErrorListResponseDto {
  @ApiProperty({type: FrontendMonitorErrorItemResponseDto, isArray: true, description: 'Error rows'})
  dataList: FrontendMonitorErrorItemResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;
}

/**
 * Wrapper for the single error detail list, with resource-level statistics.
 * Shared by the web and wx error endpoints.
 */
export class FrontendMonitorErrorOneListResponseDto {
  @ApiProperty({type: FrontendMonitorErrorItemResponseDto, isArray: true, description: 'Error rows'})
  dataList: FrontendMonitorErrorItemResponseDto[];

  @ApiProperty({type: Number, description: 'Total record count'})
  totalNum: number;

  @ApiProperty({type: Number, description: 'Current page number'})
  pageNo: number;

  @ApiProperty({type: String, description: 'Earliest occurrence time of the error'})
  first: string;

  @ApiProperty({type: String, description: 'Latest occurrence time of the error'})
  last: string;

  @ApiProperty({type: Number, description: 'Distinct affected users'})
  userNum: number;
}

/**
 * Wrapper for the marked-user error list (full rows, time ascending).
 * Shared by the web and wx error endpoints.
 */
export class FrontendMonitorErrorMarkUserListResponseDto {
  @ApiProperty({type: FrontendMonitorErrorItemResponseDto, isArray: true, description: 'Error rows'})
  list: FrontendMonitorErrorItemResponseDto[];
}
