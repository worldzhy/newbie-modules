import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for one environment row.
 * Mirrors a raw WebEnvironment Mongo document (browser/OS/geo info of one visit).
 */
export class WebMonitorEnvironmentResponseDto {
  @ApiPropertyOptional({type: String, description: 'MongoDB document ID'})
  _id?: string;

  @ApiPropertyOptional({type: String, description: 'App ID (system identifier)'})
  appId?: string;

  @ApiPropertyOptional({type: String, description: 'Visit time (ISO string)'})
  createTime?: string;

  @ApiProperty({type: String, description: 'Page URL'})
  url: string;

  @ApiPropertyOptional({type: String, description: 'Page mark'})
  markPage?: string;

  @ApiPropertyOptional({type: String, description: 'User mark'})
  markUser?: string;

  @ApiPropertyOptional({type: String, description: 'UV mark'})
  markUv?: string;

  @ApiPropertyOptional({type: String, description: 'Device mark'})
  markDevice?: string;

  @ApiPropertyOptional({type: String, description: 'Browser name'})
  browser?: string;

  @ApiPropertyOptional({type: String, description: 'Browser version'})
  browserVersion?: string;

  @ApiPropertyOptional({type: String, description: 'OS name'})
  system?: string;

  @ApiPropertyOptional({type: String, description: 'OS version'})
  systemVersion?: string;

  @ApiPropertyOptional({type: String, description: 'Visitor IP'})
  ip?: string;

  @ApiPropertyOptional({type: String, description: 'Country'})
  county?: string;

  @ApiPropertyOptional({type: String, description: 'Province'})
  province?: string;

  @ApiPropertyOptional({type: String, description: 'City'})
  city?: string;

  @ApiPropertyOptional({type: String, description: 'User phone'})
  phone?: string;

  @ApiPropertyOptional({type: String, description: 'User ID'})
  uid?: string;
}

/**
 * Group-by key of one environment aggregation row.
 * Unselected dimensions keep a literal empty string value (service behavior).
 */
export class WebMonitorEnvironmentGroupByKeyResponseDto {
  @ApiProperty({type: String, description: 'Page URL'})
  url: string;

  @ApiProperty({type: String, description: 'City (empty string when not the selected dimension)'})
  city: string;

  @ApiProperty({type: String, description: 'Browser (empty string when not the selected dimension)'})
  browser: string;

  @ApiProperty({type: String, description: 'OS (empty string when not the selected dimension)'})
  system: string;
}

/**
 * Response DTO for one environment aggregation row (grouped by url + dimension).
 */
export class WebMonitorEnvironmentGroupByItemResponseDto {
  @ApiProperty({type: WebMonitorEnvironmentGroupByKeyResponseDto, description: 'Group-by key'})
  _id: WebMonitorEnvironmentGroupByKeyResponseDto;

  @ApiProperty({type: Number, description: 'Occurrence count'})
  count: number;
}
