import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";

/**
 * Request body for beginning TOTP enrollment. When TOTP is already enabled,
 * either the current password or a valid authenticator code must prove the
 * caller's identity before a new pending secret is issued (ADR-033).
 */
export class SetupTwoFactorDto {
  @ApiPropertyOptional({ type: String, description: "Current password (required only when re-binding)." })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ type: String, description: "Current authenticator code (required only when re-binding)." })
  @IsString()
  @IsOptional()
  code?: string;
}

/** Request body for confirming TOTP enrollment. */
export class EnableTwoFactorDto {
  @ApiProperty({ type: String, description: "The 6-digit code from the authenticator app." })
  @IsString()
  @Length(6)
  @Matches(/^\d{6}$/, { message: "The code must be 6 digits." })
  code!: string;
}

/**
 * Request body for disabling TOTP. Either the current password or a valid
 * authenticator code must prove the caller's identity.
 */
export class DisableTwoFactorDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  code?: string;
}
