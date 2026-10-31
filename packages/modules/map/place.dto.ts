import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString } from "class-validator";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";

export class ListPlacesRequestDto extends CommonListRequestDto {}

export class CreatePlaceRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  address2?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  googleMapPlaceId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  googleMapPlaceResult?: Record<string, unknown>;
}

export class UpdatePlaceRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  address2?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  googleMapPlaceId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  googleMapPlaceResult?: Record<string, unknown>;
}
