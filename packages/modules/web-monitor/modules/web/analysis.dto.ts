import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Group-by key of one "top N" aggregation row.
 * The key field differs per list (url / value / browser / brand / province),
 * so every field is optional.
 */
export class WebMonitorTopCountKeyResponseDto {
  @ApiPropertyOptional({type: String, description: 'Page URL (top_pages)'})
  url?: string;

  @ApiPropertyOptional({type: String, description: 'Jump-out page URL (top_jump_out)'})
  value?: string;

  @ApiPropertyOptional({type: String, description: 'Browser name (web top_browser)'})
  browser?: string;

  @ApiPropertyOptional({type: String, description: 'Device brand (wx top_brand)'})
  brand?: string;

  @ApiPropertyOptional({type: String, description: 'Province name (provinces)'})
  province?: string;
}

/**
 * Response DTO for one "top N" aggregation row ({_id, count}).
 */
export class WebMonitorTopCountItemResponseDto {
  @ApiProperty({type: WebMonitorTopCountKeyResponseDto, description: 'Group-by key'})
  _id: WebMonitorTopCountKeyResponseDto;

  @ApiProperty({type: Number, description: 'Occurrence count'})
  count: number;
}

/**
 * Group-by key of one user funnel row.
 */
export class WebMonitorAnalysisUserKeyResponseDto {
  @ApiProperty({type: String, description: 'User mark'})
  markUser: string;
}

/**
 * Response DTO for one user funnel row ({_id: {markUser}, visitTime}).
 */
export class WebMonitorAnalysisUserItemResponseDto {
  @ApiProperty({type: WebMonitorAnalysisUserKeyResponseDto, description: 'Group-by key {markUser}'})
  _id: WebMonitorAnalysisUserKeyResponseDto;

  @ApiProperty({type: String, description: 'First visit time (ISO string)'})
  visitTime: string;
}

/**
 * Wrapper for the user funnel analysis list.
 * Shared by the web and wx analysis endpoints.
 */
export class WebMonitorAnalysisUserListResponseDto {
  @ApiProperty({type: WebMonitorAnalysisUserItemResponseDto, isArray: true, description: 'User funnel rows'})
  list: WebMonitorAnalysisUserItemResponseDto[];
}

/**
 * Wrapper for the province count statistics.
 * Shared by the web and wx analysis endpoints.
 */
export class WebMonitorProvinceCountResponseDto {
  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: WebMonitorTopCountItemResponseDto[];
}

/**
 * Wrapper for the web "top N" statistics (pages / jump-out / browser / provinces).
 */
export class WebMonitorWebTopDatasResponseDto {
  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top visited pages'})
  top_pages: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top jump-out pages'})
  top_jump_out: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top browsers'})
  top_browser: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: WebMonitorTopCountItemResponseDto[];
}

/**
 * Wrapper for the wx "top N" statistics (pages / jump-out / brand / provinces).
 * Note: wx groups by device `brand` instead of web's `browser`.
 */
export class WebMonitorWxTopDatasResponseDto {
  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top visited pages'})
  top_pages: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top jump-out pages'})
  top_jump_out: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Top device brands'})
  top_brand: WebMonitorTopCountItemResponseDto[];

  @ApiProperty({type: WebMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: WebMonitorTopCountItemResponseDto[];
}
