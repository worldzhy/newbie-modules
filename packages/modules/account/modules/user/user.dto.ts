import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MfaMethod, UserGender, UserRole, UserStatus } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { Transform, Type } from "class-transformer";
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
} from "class-validator";
import { IsStrongPassword } from "@modules/account/helpers/password.validator";

/**
 * Request DTO for creating a user (admin endpoint).
 * Only the fields used by the create form are required; the remaining scalar
 * columns are optional. Password is hashed automatically by the Prisma extension.
 */
export class CreateUserDto {
  @ApiPropertyOptional({ type: String })
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsPhoneNumber()
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({ type: String, description: "Plain password; hashed automatically by the Prisma extension." })
  @IsString()
  @IsStrongPassword()
  @IsOptional()
  password?: string | null;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: "Scalar enum array; accepted directly on create.",
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @IsOptional()
  roles?: UserRole[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  firstName?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  middleName?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  lastName?: string | null;

  @ApiPropertyOptional({ type: Date })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({ enum: UserGender })
  @IsEnum(UserGender)
  @IsOptional()
  gender?: UserGender | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  avatarFileId?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  uiAvatarsUrl?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  checkLocationOnLogin?: boolean;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  timezone?: string;

  // Two-factor fields are intentionally not writable through admin endpoints:
  // users self-manage TOTP through /account/two-factor, and the secret must
  // never be settable directly.

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  wechatOpenId?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  wechatUnionId?: string | null;

  @ApiPropertyOptional({ type: String })
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
  @ApiPropertyOptional({ type: String })
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsPhoneNumber()
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({ type: String, description: "Plain password; hashed automatically by the Prisma extension." })
  @IsString()
  @IsStrongPassword()
  @IsOptional()
  password?: string | null;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: "Replaces the whole role list (Prisma set semantics).",
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  @IsOptional()
  roles?: UserRole[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  firstName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  middleName?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  lastName?: string | null;

  @ApiPropertyOptional({ type: Date })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({ enum: UserGender })
  @IsEnum(UserGender)
  @IsOptional()
  gender?: UserGender | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  avatarFileId?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  uiAvatarsUrl?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  checkLocationOnLogin?: boolean;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsEnum(UserStatus)
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  timezone?: string;

  // Two-factor fields are intentionally not writable through admin endpoints:
  // users self-manage TOTP through /account/two-factor, and the secret must
  // never be settable directly.

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  wechatOpenId?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  wechatUnionId?: string | null;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  wechatSessionKey?: string | null;
}

/**
 * Request DTO for changing a user's password.
 */
export class ChangeUserPasswordDto {
  @ApiProperty({ type: String, required: true })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ type: String, required: true })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @IsStrongPassword()
  newPassword: string;
}

/**
 * Response DTO for User (password stripped by service.withoutPassword).
 * Sensitive fields (twoFactorSecret, wechatSessionKey) are intentionally omitted
 * from the response schema.
 */
export class UserResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: Boolean })
  checkLocationOnLogin: boolean;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiPropertyOptional({ type: String })
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  phone?: string | null;

  @ApiProperty({ enum: UserRole, isArray: true })
  roles: UserRole[];

  @ApiPropertyOptional({ type: String })
  name?: string | null;

  @ApiPropertyOptional({ type: String })
  firstName?: string | null;

  @ApiPropertyOptional({ type: String })
  middleName?: string | null;

  @ApiPropertyOptional({ type: String })
  lastName?: string | null;

  @ApiPropertyOptional({ type: Date })
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({ enum: UserGender })
  gender?: UserGender | null;

  @ApiPropertyOptional({ type: String })
  avatarFileId?: string | null;

  @ApiPropertyOptional({ type: String })
  uiAvatarsUrl?: string | null;

  @ApiProperty({ type: String })
  timezone: string;

  @ApiProperty({ enum: MfaMethod })
  twoFactorMethod: MfaMethod;

  @ApiPropertyOptional({ type: String })
  twoFactorPhone?: string | null;

  @ApiPropertyOptional({ type: Date })
  lastLoginAt?: Date | null;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;

  @ApiPropertyOptional({ type: String })
  wechatOpenId?: string | null;

  @ApiPropertyOptional({ type: String })
  wechatUnionId?: string | null;
}

/**
 * Response DTO for user creation (only selected fields returned).
 */
export class CreateUserResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiPropertyOptional({ type: String })
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  phone?: string | null;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiPropertyOptional({ type: String })
  name?: string | null;

  @ApiPropertyOptional({ type: String })
  firstName?: string | null;

  @ApiPropertyOptional({ type: String })
  middleName?: string | null;

  @ApiPropertyOptional({ type: String })
  lastName?: string | null;
}

/**
 * Response DTO for password change (only identity fields returned).
 */
export class UserChangePasswordResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiPropertyOptional({ type: String })
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  phone?: string | null;
}

/**
 * Paginated list response for users.
 */
export class ListUsersResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: UserResponseDto, isArray: true })
  declare records: UserResponseDto[];
}

/**
 * Request DTO for the paginated user list (admin endpoint).
 *
 * Pagination (required page/pageSize) is inherited from the framework
 * CommonListRequestDto to match findManyInManyPages; only optional narrowing
 * filters are declared here. When `roles` is omitted or empty the list is
 * unfiltered by role — callers must never be forced to pass their own roles
 * just to satisfy the contract. `roles` narrows by role overlap (Prisma
 * `hasSome`); query strings can carry a single value or repeated keys, so
 * the Transform normalises both into an array.
 */
export class ListUsersRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Fuzzy search by name" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: "Filter by role overlap (hasSome); omit for no role filtering",
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string[] | undefined => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === "string") return [value];
    return undefined;
  })
  @IsArray()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];
}
