import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';

export class SessionsListRequestDto extends CommonListRequestDto {}

/**
 * Response DTO for a single Session record (refreshToken stripped by expose()).
 */
export class SessionResponseDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  accessToken: string;

  @ApiProperty({type: String})
  ipAddress: string;

  @ApiPropertyOptional({type: String})
  userAgent?: string | null;

  @ApiPropertyOptional({type: String})
  city?: string | null;

  @ApiPropertyOptional({type: String})
  region?: string | null;

  @ApiPropertyOptional({type: String})
  timezone?: string | null;

  @ApiPropertyOptional({type: String})
  countryCode?: string | null;

  @ApiPropertyOptional({type: String})
  browser?: string | null;

  @ApiPropertyOptional({type: String})
  operatingSystem?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: String})
  userId: string;

  @ApiPropertyOptional({type: Boolean})
  isCurrentSession?: boolean;
}

/**
 * Paginated list response for sessions.
 */
export class SessionsListResponseDto extends CommonListResponseDto {
  @ApiProperty({
    type: SessionResponseDto,
    isArray: true,
  })
  declare records: SessionResponseDto[];
}
