import {MfaMethod, User} from '@prisma/client';
import {ApiProperty} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsLocale,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MinLength,
} from 'class-validator';

import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {
  CommonPaginationReqDto,
  CommonPaginationResDto,
} from '@devbie/newbie/common.dto';

export class UsersListReqDto extends CommonPaginationReqDto {

}

export class UsersListResDto {
  @ApiProperty({
    type: expose<User>,
    isArray: true,
  })
  records: Expose<User>[];

  @ApiProperty({
    type: CommonPaginationResDto,
  })
  pagination: CommonPaginationResDto;
}

export class UpdateUserDto {
  @IsBoolean()
  @IsOptional()
  checkLocationOnLogin?: boolean;

  @IsString()
  @Length(2, 2)
  @IsOptional()
  countryCode?: string;

  @IsString()
  @IsIn(['MALE', 'FEMALE', 'NONBINARY', 'UNKNOWN'])
  @IsOptional()
  gender?: 'MALE' | 'FEMALE' | 'NONBINARY' | 'UNKNOWN';

  @IsString()
  @MinLength(3)
  @IsOptional()
  name?: string;

  @IsIn(['ACCOUNT', 'UPDATES', 'PROMOTIONS'])
  @IsOptional()
  notificationEmails?: 'ACCOUNT' | 'UPDATES' | 'PROMOTIONS';

  @IsString()
  @IsOptional()
  newPassword?: string;

  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsBoolean()
  @IsOptional()
  ignorePwnedPassword?: boolean;

  @IsLocale()
  @IsOptional()
  prefersLanguage?: string;

  @IsString()
  @IsIn(['NO_PREFERENCE', 'LIGHT', 'DARK'])
  @IsOptional()
  prefersColorScheme?: 'NO_PREFERENCE' | 'LIGHT' | 'DARK';

  @IsString()
  @IsIn(['NO_PREFERENCE', 'REDUCE'])
  @IsOptional()
  prefersReducedMotion?: 'NO_PREFERENCE' | 'REDUCE';

  @IsUrl()
  @IsOptional()
  profilePictureUrl?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsEnum(['NONE', 'TOTP', 'EMAIL'])
  @IsOptional()
  twoFactorMethod?: MfaMethod;
}
