import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from "class-validator";

/**
 * Client registration is admin-only and irreversible in the credential sense:
 * the plaintext secret is returned exactly once on creation. A public client
 * (e.g. a desktop app) omits the secret and authenticates solely through PKCE.
 */
export class CreateOAuthClientDto {
  @ApiProperty({
    type: String,
    example: "demo-app",
    description: "Stable, human-readable client id handed to third parties",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientId!: string;

  @ApiProperty({
    type: String,
    isArray: true,
    example: ["demo-app://oauth/callback"],
    description: "Allowed redirect URIs; authorize rejects anything not exactly matching one entry",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  @IsNotEmpty()
  redirectUris!: string[];

  @ApiProperty({
    type: String,
    isArray: true,
    example: ["identity"],
    description: "Scope whitelist this client may request; authorize intersects the requested scope",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsNotEmpty()
  scopes!: string[];

  @ApiPropertyOptional({ type: String, example: "Demo desktop app" })
  @IsString()
  @MaxLength(256)
  @IsOptional()
  description?: string;
}

export class OAuthClientResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  clientId!: string;

  @ApiProperty({ type: String, isArray: true })
  redirectUris!: string[];

  @ApiProperty({ type: String, isArray: true })
  scopes!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  revokedAt?: Date | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: String })
  createdBy!: string;

  /**
   * Plaintext client secret, returned exactly once at creation. It is never
   * stored in plaintext and never returned again; the admin must copy it
   * immediately. Absent on list and revoke responses.
   */
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Plaintext secret, returned only at creation time",
  })
  clientSecret?: string | null;
}

/**
 * Authorization-code grant request (RFC 6749 §4.1.3). The token endpoint is
 * public: it authenticates the caller by presenting a one-time code, not by a
 * client secret, so no guard decorator is attached.
 */
export class ExchangeCodeForTokenDto {
  @ApiProperty({ type: String, example: "authorization_code" })
  @IsString()
  @IsNotEmpty()
  grantType!: string;

  @ApiProperty({ type: String, description: "The code received at the end of the authorize flow" })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ type: String, description: "Must be identical to the redirect_uri used at authorize time" })
  @IsString()
  @IsNotEmpty()
  redirectUri!: string;

  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ type: String, description: "PKCE verifier; S256(code_verifier) must equal the stored challenge" })
  @IsString()
  @IsNotEmpty()
  codeVerifier!: string;
}

/** RFC 6749 §5.1 token response. */
export class OAuthTokenResponseDto {
  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: String })
  refreshToken!: string;

  @ApiProperty({ type: String, example: "Bearer" })
  tokenType!: string;

  @ApiProperty({ type: Number, example: 600 })
  expiresIn!: number;

  @ApiProperty({ type: String })
  scope!: string;
}

/** RFC 7009 revoke request. The body token is the refresh token to invalidate. */
export class RevokeOAuthTokenDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({ type: String, example: "refresh_token" })
  @IsString()
  @IsOptional()
  tokenTypeHint?: string;
}
