import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';

/**
 * Response DTO for ApprovedSubnet.
 * Note: 'subnet' is a hashed/anonymized IP subnet and is included as returned
 * by the existing expose() helper (which only strips password & refreshToken).
 */
export class ApprovedSubnetResponseDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  subnet: string;

  @ApiPropertyOptional({type: String})
  city?: string | null;

  @ApiPropertyOptional({type: String})
  region?: string | null;

  @ApiPropertyOptional({type: String})
  timezone?: string | null;

  @ApiPropertyOptional({type: String})
  countryCode?: string | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: String})
  userId: string;
}
