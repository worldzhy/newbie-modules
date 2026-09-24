import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Group-by key of one "top N" aggregation row.
 * The key field differs per list (url / value / browser / brand / province),
 * so every field is optional.
 */
export class FrontendMonitorTopCountKeyResponseDto {
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
export class FrontendMonitorTopCountItemResponseDto {
  @ApiProperty({type: FrontendMonitorTopCountKeyResponseDto, description: 'Group-by key'})
  _id: FrontendMonitorTopCountKeyResponseDto;

  @ApiProperty({type: Number, description: 'Occurrence count'})
  count: number;
}

/**
 * Group-by key of one user funnel row.
 */
export class FrontendMonitorAnalysisUserKeyResponseDto {
  @ApiProperty({type: String, description: 'User mark'})
  markUser: string;
}

/**
 * Response DTO for one user funnel row ({_id: {markUser}, visitTime}).
 */
export class FrontendMonitorAnalysisUserItemResponseDto {
  @ApiProperty({type: FrontendMonitorAnalysisUserKeyResponseDto, description: 'Group-by key {markUser}'})
  _id: FrontendMonitorAnalysisUserKeyResponseDto;

  @ApiProperty({type: String, description: 'First visit time (ISO string)'})
  visitTime: string;
}

/**
 * Wrapper for the user funnel analysis list.
 * Shared by the web and wx analysis endpoints.
 */
export class FrontendMonitorAnalysisUserListResponseDto {
  @ApiProperty({type: FrontendMonitorAnalysisUserItemResponseDto, isArray: true, description: 'User funnel rows'})
  list: FrontendMonitorAnalysisUserItemResponseDto[];
}

/**
 * Wrapper for the province count statistics.
 * Shared by the web and wx analysis endpoints.
 */
export class FrontendMonitorProvinceCountResponseDto {
  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: FrontendMonitorTopCountItemResponseDto[];
}

/**
 * Wrapper for the web "top N" statistics (pages / jump-out / browser / provinces).
 */
export class FrontendMonitorWebTopDatasResponseDto {
  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top visited pages'})
  top_pages: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top jump-out pages'})
  top_jump_out: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top browsers'})
  top_browser: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: FrontendMonitorTopCountItemResponseDto[];
}

/**
 * Wrapper for the wx "top N" statistics (pages / jump-out / brand / provinces).
 * Note: wx groups by device `brand` instead of web's `browser`.
 */
export class FrontendMonitorWxTopDatasResponseDto {
  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top visited pages'})
  top_pages: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top jump-out pages'})
  top_jump_out: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Top device brands'})
  top_brand: FrontendMonitorTopCountItemResponseDto[];

  @ApiProperty({type: FrontendMonitorTopCountItemResponseDto, isArray: true, description: 'Province count rows'})
  provinces: FrontendMonitorTopCountItemResponseDto[];
}
