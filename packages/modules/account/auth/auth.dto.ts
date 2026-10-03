import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MfaMethod, VerificationCodeUse } from "@generated/prisma/client";
import { IsStrongPassword } from "@modules/account/helpers/password.validator";
import {
  IsDate,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MinLength,
} from "class-validator";

export class SignUpDto {
  @ApiProperty({ type: String, required: true })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ type: String, required: false })
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsStrongPassword()
  @IsOptional()
  password?: string | null;

  // Roles are intentionally absent: self-service sign-up always receives the
  // default USER role. Letting clients choose roles would allow instant
  // privilege escalation to ADMIN.

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  middleName?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  dateOfBirth?: Date;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  @IsIn(["MALE", "FEMALE", "NONBINARY", "UNKNOWN"])
  gender?: "MALE" | "FEMALE" | "NONBINARY" | "UNKNOWN";

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  avatarFileId?: string;
}

export class LoginByPasswordRequestDto {
  @ApiProperty({ type: String, required: true })
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({ type: String, required: true })
  @IsString()
  @MinLength(8)
  password: string;
}

export class LoginByPasswordResponseDto {
  @ApiProperty({ type: String, required: true })
  token: string;

  @ApiProperty({ type: Number, required: true })
  tokenExpiresInSeconds: number;

  // Present instead of `token` when the account has TOTP enabled: the client
  // collects the authenticator code and completes login at /auth/login-by-totp.
  @ApiPropertyOptional({ description: "Short-lived MFA challenge token; returned only when MFA is required." })
  totpToken?: string;

  @ApiPropertyOptional({ enum: MfaMethod })
  type?: MfaMethod;

  @ApiPropertyOptional({ description: "True when a second authentication factor is required." })
  multiFactorRequired?: boolean;
}

/**
 * Response DTO for Google OAuth redirect callback. A successful handshake
 * returns the platform access token, identical to password login; the refresh
 * token is delivered through an HttpOnly cookie.
 */
export class GoogleOAuthRedirectResponseDto extends LoginByPasswordResponseDto {}

/**
 * Response DTO for sending verification code.
 */
export class SendVerificationCodeResponseDto {
  @ApiProperty({ type: Number })
  secondsOfCountdown: number;
}

/**
 * Request DTO for sending verification code to email or phone.
 */
export class SendVerificationCodeRequestDto {
  @ApiProperty({ type: String, required: false, description: "The email address to send the code to." })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ type: String, required: false, description: "The phone number to send the code to." })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    type: String,
    required: true,
    description: "The purpose of the verification code (e.g. LOGIN_BY_EMAIL, RESET_PASSWORD).",
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
  @ApiProperty({ type: String, required: true, description: "The account (email or phone)." })
  @IsString()
  @IsNotEmpty()
  account: string;

  @ApiProperty({ type: String, required: true, description: "The 6-digit verification code." })
  @IsString()
  @IsNotEmpty()
  verificationCode: string;
}

/**
 * Response DTO for logout operation.
 */
export class LogoutResponseDto {
  @ApiProperty({ type: Object })
  data: { message: string };
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
