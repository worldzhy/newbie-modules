import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {MfaMethod, UserGender, UserRole, UserStatus} from '@generated/prisma/client';
import {CommonListResponseDto} from '@devbie/newbie/common.dto';
import {Type} from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Request DTO for creating a user (admin endpoint).
 * Only the fields used by the create form are required; the remaining scalar
 * columns are optional. Password is hashed automatically by the Prisma extension.
 */
export class CreateUserDto {
  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  username?: string | null;

  @ApiPropertyOptional({type: String})
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional({type: String})
  @IsPhoneNumber()
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({type: String, description: 'Plain password; hashed automatically by the Prisma extension.'})
  @IsString()
  @IsOptional()
  password?: string | null;

  @ApiPropertyOptional({enum: UserRole, isArray: true, description: 'Scalar enum array; accepted directly on create.'})
  @IsArray()
  @IsEnum(UserRole, {each: true})
  @IsOptional()
  roles?: UserRole[];

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  name?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  firstName?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  middleName?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  lastName?: string | null;

  @ApiPropertyOptional({type: Date})
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({enum: UserGender})
  @IsEnum(UserGender)
  @IsOptional()
  gender?: UserGender | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  avatarFileId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  uiAvatarsUrl?: string | null;

  @ApiPropertyOptional({type: Boolean})
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  checkLocationOnLogin?: boolean;

  @ApiPropertyOptional({enum: UserStatus})
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({enum: MfaMethod})
  @IsEnum(MfaMethod)
  @IsOptional()
  twoFactorMethod?: MfaMethod;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  twoFactorPhone?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  twoFactorSecret?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatOpenId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatUnionId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatSessionKey?: string | null;
}

/**
 * Request DTO for updating a user. All fields are optional.
 * Note: 'roles' is accepted as a plain enum array and wrapped into
 * {set: roles} in the controller, as required by Prisma for scalar lists.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  username?: string | null;

  @ApiPropertyOptional({type: String})
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional({type: String, nullable: true})
  @IsPhoneNumber()
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({type: String, description: 'Plain password; hashed automatically by the Prisma extension.'})
  @IsString()
  @IsOptional()
  password?: string | null;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: 'Replaces the whole role list (Prisma set semantics).',
  })
  @IsArray()
  @IsEnum(UserRole, {each: true})
  @IsOptional()
  roles?: UserRole[];

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  name?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  firstName?: string | null;

  @ApiPropertyOptional({type: String, nullable: true})
  @IsString()
  @IsOptional()
  middleName?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  lastName?: string | null;

  @ApiPropertyOptional({type: Date})
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({enum: UserGender})
  @IsEnum(UserGender)
  @IsOptional()
  gender?: UserGender | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  avatarFileId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  uiAvatarsUrl?: string | null;

  @ApiPropertyOptional({type: Boolean})
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  checkLocationOnLogin?: boolean;

  @ApiPropertyOptional({enum: UserStatus})
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({enum: MfaMethod})
  @IsEnum(MfaMethod)
  @IsOptional()
  twoFactorMethod?: MfaMethod;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  twoFactorPhone?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  twoFactorSecret?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatOpenId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatUnionId?: string | null;

  @ApiPropertyOptional({type: String})
  @IsString()
  @IsOptional()
  wechatSessionKey?: string | null;
}

/**
 * Request DTO for changing a user's password.
 */
export class ChangeUserPasswordDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

/**
 * Response DTO for User (password stripped by service.withoutPassword).
 * Sensitive fields (twoFactorSecret, wechatSessionKey) are intentionally omitted
 * from the response schema.
 */
export class UserResponseDto {
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
}

/**
 * Response DTO for user creation (only selected fields returned).
 */
export class CreateUserResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiPropertyOptional({type: String})
  email?: string | null;

  @ApiPropertyOptional({type: String})
  phone?: string | null;

  @ApiProperty({enum: UserStatus})
  status: UserStatus;

  @ApiPropertyOptional({type: String})
  name?: string | null;

  @ApiPropertyOptional({type: String})
  firstName?: string | null;

  @ApiPropertyOptional({type: String})
  middleName?: string | null;

  @ApiPropertyOptional({type: String})
  lastName?: string | null;
}

/**
 * Response DTO for password change (only identity fields returned).
 */
export class UserChangePasswordResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiPropertyOptional({type: String})
  email?: string | null;

  @ApiPropertyOptional({type: String})
  phone?: string | null;
}

/**
 * Paginated list response for users.
 */
export class UserListResponseDto extends CommonListResponseDto {
  @ApiProperty({type: UserResponseDto, isArray: true})
  declare records: UserResponseDto[];
}
