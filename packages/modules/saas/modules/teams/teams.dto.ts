import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {ApiProperty} from '@nestjs/swagger';

export class CreateTeamDto {
  @IsBoolean()
  @IsOptional()
  autoJoinDomain?: boolean;

  @IsBoolean()
  @IsOptional()
  forceTwoFactor?: boolean;

  @IsArray()
  @IsOptional()
  ipRestrictions?: string;

  @ApiProperty({
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsBoolean()
  @IsOptional()
  onlyAllowDomain?: boolean;

  @IsString()
  @IsOptional()
  profilePictureUrl?: string;
}

export class UpdateTeamDto {
  @IsBoolean()
  @IsOptional()
  autoJoinDomain?: boolean;

  @IsBoolean()
  @IsOptional()
  forceTwoFactor?: boolean;

  @IsArray()
  @IsOptional()
  ipRestrictions?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  onlyAllowDomain?: boolean;

  @IsString()
  @IsOptional()
  profilePictureUrl?: string;
}

export class ReplaceTeamDto {
  @IsBoolean()
  @IsNotEmpty()
  autoJoinDomain!: boolean;

  @IsBoolean()
  @IsNotEmpty()
  forceTwoFactor!: boolean;

  @IsArray()
  @IsNotEmpty()
  ipRestrictions!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsBoolean()
  @IsNotEmpty()
  onlyAllowDomain!: boolean;

  @IsString()
  @IsNotEmpty()
  profilePictureUrl!: string;

  @IsObject()
  @IsNotEmpty()
  attributes!: Record<string, any>;
}
