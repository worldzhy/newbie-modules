import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {UserRole} from '@generated/prisma/client';
import {IsEmail, IsNotEmpty, IsOptional, IsString, MinLength} from 'class-validator';

export class GetCurrentUserResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiPropertyOptional({type: String})
  email?: string | null;

  @ApiPropertyOptional({type: String})
  phone?: string | null;

  @ApiProperty({type: String, isArray: true})
  roles: UserRole[];

  @ApiPropertyOptional({type: String})
  name?: string | null;

  @ApiPropertyOptional({type: String})
  firstName?: string | null;

  @ApiPropertyOptional({type: String})
  middleName?: string | null;

  @ApiPropertyOptional({type: String})
  lastName?: string | null;

  @ApiPropertyOptional({type: String})
  avatarFileId?: string | null;
}

/**
 * Response DTO for password change / reset operations.
 * Only returns non-sensitive identity fields.
 */
export class PasswordChangeResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiPropertyOptional({type: String})
  email?: string | null;

  @ApiPropertyOptional({type: String})
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
  @ApiPropertyOptional({type: String, description: 'The email of the account to reset password for.'})
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({type: String, description: 'The phone of the account to reset password for.'})
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({type: String, description: 'The verification code received via email or phone.'})
  @IsString()
  @IsNotEmpty()
  verificationCode!: string;

  @ApiProperty({type: String, description: 'The new password.'})
  @IsString()
  @MinLength(8)
  @IsNotEmpty()
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    type: String,
    required: true,
    description: 'The user ID of the account to change the password for.',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    type: String,
    required: true,
    description: 'The current password of the account.',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({
    type: String,
    required: true,
    description: 'The new password for the account.',
  })
  @IsString()
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
