import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, Length, Matches } from "class-validator";

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
  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiProperty({ type: String, required: false })
  @IsString()
  @IsOptional()
  code?: string;
}
