import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {UserRole, VerificationCodeUse} from '@generated/prisma/client';
import {Type} from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({type: String, required: true})
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({type: String, required: false})
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  password?: string | null;

  @ApiProperty({type: String, isArray: true, required: false})
  @IsArray()
  @IsOptional()
  roles?: UserRole[];

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  middleName?: string;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({type: Date, required: false})
  @IsDate()
  @IsOptional()
  dateOfBirth?: Date;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'NONBINARY', 'UNKNOWN'])
  gender?: 'MALE' | 'FEMALE' | 'NONBINARY' | 'UNKNOWN';

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  avatarFileId?: string;
}

export class LoginByPasswordRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({type: Boolean, required: false, default: false})
  @IsOptional()
  @Type(() => Boolean)
  skipEmailCheck?: boolean;
}

export class LoginByPasswordResponseDto {
  @ApiProperty({type: String, required: true})
  token: string;

  @ApiProperty({type: Number, required: true})
  tokenExpiresInSeconds: number;
}

/**
 * Response DTO for Google OAuth redirect callback.
 */
export class GoogleOAuthRedirectResponseDto {
  @ApiProperty({type: String})
  status: string;

  @ApiProperty({type: String})
  message: string;

  @ApiProperty({type: Object})
  data: object;
}

/**
 * Response DTO for sending verification code.
 */
export class SendVerificationCodeResponseDto {
  @ApiProperty({type: Number})
  secondsOfCountdown: number;
}

/**
 * Request DTO for sending verification code to email or phone.
 */
export class SendVerificationCodeRequestDto {
  @ApiProperty({type: String, required: false, description: 'The email address to send the code to.'})
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({type: String, required: false, description: 'The phone number to send the code to.'})
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    type: String,
    required: true,
    description: 'The purpose of the verification code (e.g. LOGIN_BY_EMAIL, RESET_PASSWORD).',
    enum: VerificationCodeUse,
  })
  @IsString()
  @IsNotEmpty()
  use: VerificationCodeUse;
}

/**
 * Request DTO for logging in with a verification code.
 */
export class LoginByVerificationCodeRequestDto {
  @ApiProperty({type: String, required: true, description: 'The account (email or phone).'})
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({type: String, required: true, description: 'The 6-digit verification code.'})
  @IsString()
  @IsNotEmpty()
  verificationCode: string;
}

/**
 * Request DTO for logging in with an API key and secret.
 * Note: the ApiKey guard actually reads key/secret from request headers;
 * this DTO only documents the request body contract for OpenAPI clients.
 */
export class LoginByApiKeyRequestDto {
  @ApiProperty({type: String, required: true, description: 'The API key.'})
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({type: String, required: true, description: 'The API secret.'})
  @IsString()
  @IsNotEmpty()
  secret: string;
}

/**
 * Request DTO for logging in with a user profile.
 * The Profile guard runs before the validation pipe and reads the raw body.
 */
export class LoginByProfileRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  middleName: string;

  @ApiProperty({type: String, required: true})
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiPropertyOptional({type: String, description: 'Optional name suffix, e.g. PhD.'})
  @IsString()
  @IsOptional()
  suffix?: string;

  @ApiProperty({type: Date, required: true, description: 'ISO 8601 date string.'})
  @IsDate()
  @Type(() => Date)
  dateOfBirth: Date;
}

/**
 * Request DTO for logging in with a user UUID.
 */
export class LoginByUuidRequestDto {
  @ApiProperty({type: String, required: true, description: 'The UUID (user id).'})
  @IsUUID()
  uuid: string;
}

/**
 * Response DTO for logout operation.
 */
export class LogoutResponseDto {
  @ApiProperty({type: Object})
  data: {message: string};
}

export class TotpLoginDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @IsOptional()
  origin?: string;

  @IsString()
  @Length(6)
  @IsNotEmpty()
  code!: string;
}
