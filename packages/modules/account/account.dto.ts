import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MfaMethod, NavPlacement, UserGender, UserTheme } from "@generated/prisma/client";
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { IsStrongPassword } from "@modules/account/helpers/password.validator";

export class GetCurrentUserResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  phone?: string | null;

  @ApiProperty({ type: String, isArray: true })
  roles!: string[];

  @ApiProperty({
    type: () => UserPermissionGroupSummary,
    isArray: true,
    description: "Union of permission groups across all held roles. ADMIN holders get every group implicitly.",
  })
  permissionGroups!: UserPermissionGroupSummary[];

  @ApiPropertyOptional({ enum: MfaMethod })
  twoFactorMethod?: MfaMethod;

  @ApiPropertyOptional({ type: String })
  name?: string | null;

  @ApiPropertyOptional({ type: String })
  firstName?: string | null;

  @ApiPropertyOptional({ type: String })
  middleName?: string | null;

  @ApiPropertyOptional({ type: String })
  lastName?: string | null;

  @ApiPropertyOptional({ type: String })
  avatarFileId?: string | null;

  @ApiPropertyOptional({ type: String, description: 'BCP-47 language tag, e.g. "en" or "zh".' })
  language?: string | null;

  @ApiPropertyOptional({ enum: UserTheme, description: "LIGHT | DARK | SYSTEM" })
  theme?: UserTheme | null;

  @ApiPropertyOptional({ type: String, description: 'IANA timezone name, e.g. "Asia/Shanghai".' })
  timezone?: string | null;
}

/**
 * Trimmed PermissionGroup projection returned by /account/me. Frontend uses
 * this to decide which nav entries to render — no permissions or description.
 */
export class UserPermissionGroupSummary {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  routePath!: string;

  @ApiProperty({ enum: NavPlacement })
  navPlacement!: NavPlacement;

  @ApiProperty({ type: Number, description: "Header nav position (1-based)." })
  navOrder!: number;

  @ApiProperty({ type: String })
  navLabel!: string;

  @ApiPropertyOptional({ type: String })
  navIcon?: string | null;
}

/**
 * Response DTO for password change / reset operations.
 * Only returns non-sensitive identity fields.
 */
export class PasswordChangeResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiPropertyOptional({ type: String })
  email?: string | null;

  @ApiPropertyOptional({ type: String })
  phone?: string | null;
}

export class ResendEmailVerificationDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsOptional()
  origin?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsOptional()
  origin?: string;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({ type: String, description: "The email of the account to reset password for." })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ type: String, description: "The phone of the account to reset password for." })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ type: String, description: "The verification code received via email or phone." })
  @IsString()
  @IsNotEmpty()
  verificationCode!: string;

  @ApiProperty({ type: String, description: "The new password." })
  @IsString()
  @MinLength(8)
  @IsStrongPassword()
  @IsNotEmpty()
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    type: String,
    description: "The current password of the account.",
  })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({
    type: String,
    description: "The new password for the account.",
  })
  @IsString()
  @IsStrongPassword()
  @IsNotEmpty()
  newPassword!: string;
}

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsOptional()
  origin?: string;
}

/**
 * Whitelist of profile fields a user may change on themselves.
 * Sensitive fields (roles, status, password, email, phone, two-factor
 * settings) are intentionally absent: the global ValidationPipe strips
 * undeclared properties, so they cannot be smuggled through this endpoint.
 */
export class UpdateMeDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  middleName?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ type: String, enum: UserGender })
  @IsEnum(UserGender)
  @IsOptional()
  gender?: UserGender;

  @ApiPropertyOptional({ type: String, format: "date", description: "ISO 8601 date string." })
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  timezone?: string;

  // Only the shape is validated here. Whether a given language is supported is
  // a host concern: the registry cannot know a host's locale list (ADR-049).
  @ApiPropertyOptional({ type: String, description: 'BCP-47 language tag, e.g. "en" or "zh".' })
  @IsString()
  @MaxLength(35)
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/, { message: "language must be a BCP-47 language tag" })
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ enum: UserTheme, description: "LIGHT | DARK | SYSTEM" })
  @IsEnum(UserTheme)
  @IsOptional()
  theme?: UserTheme;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  avatarFileId?: string;
}
