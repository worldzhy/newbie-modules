import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {UserRole, UserStatus, UserGender, MfaMethod} from '@generated/prisma/client';
import {IsString} from 'class-validator';

export class WechatLoginDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  openId: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  phone: string;
}

export class WechatCodeLoginDto {
  /**
   * 微信登录临时凭证
   */
  @IsString()
  code: string;
}

/**
 * User response DTO used in WeChat login response (sensitive fields stripped).
 */
export class WechatUserResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: Boolean})
  checkLocationOnLogin: boolean;

  @ApiProperty({enum: UserStatus})
  status: UserStatus;

  @ApiPropertyOptional({type: String})
  username?: string | null;

  @ApiPropertyOptional({type: String})
  email?: string | null;

  @ApiPropertyOptional({type: String})
  phone?: string | null;

  @ApiProperty({enum: UserRole, isArray: true})
  roles: UserRole[];

  @ApiPropertyOptional({type: String})
  name?: string | null;

  @ApiPropertyOptional({type: String})
  firstName?: string | null;

  @ApiPropertyOptional({type: String})
  middleName?: string | null;

  @ApiPropertyOptional({type: String})
  lastName?: string | null;

  @ApiPropertyOptional({type: Date})
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({enum: UserGender})
  gender?: UserGender | null;

  @ApiPropertyOptional({type: String})
  avatarFileId?: string | null;

  @ApiPropertyOptional({type: String})
  uiAvatarsUrl?: string | null;

  @ApiProperty({type: String})
  timezone: string;

  @ApiProperty({enum: MfaMethod})
  twoFactorMethod: MfaMethod;

  @ApiPropertyOptional({type: String})
  twoFactorPhone?: string | null;

  @ApiPropertyOptional({type: Date})
  lastLoginAt?: Date | null;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiPropertyOptional({type: String})
  wechatOpenId?: string | null;

  @ApiPropertyOptional({type: String})
  wechatUnionId?: string | null;

  @ApiProperty({type: Boolean})
  hasPassword: boolean;
}

/**
 * Response DTO for WeChat login.
 * Returns access token, refresh token, token expiry and the authenticated user.
 */
export class WechatLoginResponseDto {
  @ApiProperty({type: String})
  token: string;

  @ApiProperty({type: Number})
  tokenExpiresInSeconds: number;

  @ApiProperty({type: String})
  refreshToken: string;

  @ApiProperty({type: WechatUserResponseDto})
  user: WechatUserResponseDto;
}

/**
 * Response DTO for WeChat refresh access token.
 */
export class WechatRefreshAccessTokenResponseDto {
  @ApiProperty({type: String})
  token: string;

  @ApiProperty({type: Number})
  tokenExpiresInSeconds: number;

  @ApiProperty({type: String})
  refreshToken: string;
}
