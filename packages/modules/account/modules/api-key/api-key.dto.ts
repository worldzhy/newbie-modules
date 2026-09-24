import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsArray, IsNotEmpty, IsOptional, IsString} from 'class-validator';

export class CreateApiKeyDto {
  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsOptional()
  ipRestrictions?: string[];

  @ApiPropertyOptional({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsOptional()
  referrerRestrictions?: string[];
}

export class UpdateApiKeyDto {
  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsOptional()
  scopes?: string[];

  @ApiPropertyOptional({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsOptional()
  ipRestrictions?: string[];

  @ApiPropertyOptional({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsOptional()
  referrerRestrictions?: string[];
}

export class ReplaceApiKeyDto {
  @ApiProperty({type: String})
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({type: String})
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsNotEmpty()
  scopes!: string[];

  @ApiProperty({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsNotEmpty()
  ipRestrictions!: string[];

  @ApiProperty({type: [String]})
  @IsArray()
  @IsString({each: true})
  @IsNotEmpty()
  referrerRestrictions!: string[];
}

/**
 * Response DTO for API key operations.
 * Note: 'secret' is only returned on creation; subsequent GETs also return it
 * via the existing expose() helper which does not strip it.
 */
export class ApiKeyResponseDto {
  @ApiProperty({type: Number})
  id: number;

  @ApiProperty({type: String})
  key: string;

  @ApiProperty({type: String})
  secret: string;

  @ApiPropertyOptional({type: String})
  description?: string | null;

  @ApiPropertyOptional({type: Object})
  ipRestrictions?: object | null;

  @ApiPropertyOptional({type: Object})
  referrerRestrictions?: object | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: String})
  userId: string;

  @ApiPropertyOptional({type: String})
  organizationId?: string | null;
}

/**
 * Response DTO for API key logs (free-form records from log storage).
 * Each record is an arbitrary object from the log backend.
 */
export class ApiKeyLogResponseDto {
  @ApiProperty({type: Object})
  data: object;
}
