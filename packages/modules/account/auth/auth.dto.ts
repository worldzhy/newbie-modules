import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { MfaMethod, VerificationCodeUse } from "@generated/prisma/client";
import { IsStrongPassword } from "@modules/account/helpers/password.validator";
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MinLength,
} from "class-validator";

export class SignUpDto {
  @ApiProperty({ type: String })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({ type: String })
  @IsPhoneNumber()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsStrongPassword()
  @IsOptional()
  password?: string | null;

  // Roles are intentionally absent: self-service sign-up always receives the
  // default USER role. Letting clients choose roles would allow instant
  // privilege escalation to ADMIN.

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

  @ApiPropertyOptional({ type: Date })
  @Type(() => Date)
  @IsDate()
  @IsOptional()
  dateOfBirth?: Date;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  @IsIn(["MALE", "FEMALE", "NONBINARY", "UNKNOWN"])
  gender?: "MALE" | "FEMALE" | "NONBINARY" | "UNKNOWN";

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  avatarFileId?: string;
}

export class LoginByPasswordRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  account!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class LoginByPasswordResponseDto {
  // Present when the login completed; absent when an MFA challenge is returned.
  @ApiPropertyOptional({ type: String })
  token?: string;

  @ApiPropertyOptional({ type: Number })
  tokenExpiresInSeconds?: number;

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
 * Request DTO for completing login by approving a new subnet — the token comes
 * from the approval link sent to the account's email.
 */
export class LoginByApprovedSubnetRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

/**
 * Request DTO for verifying the signup email — the token comes from the
 * verification link sent to the address being confirmed.
 */
export class SignupEmailVerifyRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

/**
 * Response DTO for sending verification code.
 */
export class SendVerificationCodeResponseDto {
  @ApiProperty({ type: Number })
  secondsOfCountdown!: number;
}

/**
 * Request DTO for sending verification code to email or phone.
 */
export class SendVerificationCodeRequestDto {
  @ApiPropertyOptional({ type: String, description: "The email address to send the code to." })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ type: String, description: "The phone number to send the code to." })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    type: String,
    description: "The purpose of the verification code (e.g. LOGIN_BY_EMAIL, RESET_PASSWORD).",
    enum: VerificationCodeUse,
  })
  @IsString()
  @IsEnum(VerificationCodeUse)
  @IsNotEmpty()
  use!: VerificationCodeUse;
}

/**
 * Request DTO for logging in with a verification code.
 */
export class LoginByVerificationCodeRequestDto {
  @ApiProperty({ type: String, description: "The account (email or phone)." })
  @IsString()
  @IsNotEmpty()
  account!: string;

  @ApiProperty({ type: String, description: "The 6-digit verification code." })
  @IsString()
  @IsNotEmpty()
  verificationCode!: string;
}

/**
 * Response DTO for logout operation.
 */
export class LogoutResponseDto {
  @ApiProperty({ type: Object })
  data!: { message: string };
}

export class TotpLoginDto {
  @ApiProperty({ type: String, description: "Short-lived MFA challenge token from the initial login attempt." })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  origin?: string;

  @ApiProperty({ type: String, description: "The 6-digit authenticator code." })
  @IsString()
  @Length(6)
  @IsNotEmpty()
  code!: string;
}
