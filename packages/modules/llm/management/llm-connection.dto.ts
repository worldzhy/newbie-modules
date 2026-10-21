import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from "class-validator";
import { ANTHROPIC_PROVIDER, LLM_PROVIDERS } from "./llm-providers";

export class CreateLlmConnectionDto {
  @ApiProperty({ description: "User-friendly display name for this connection" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    enum: LLM_PROVIDERS,
    default: "openai-compatible",
    description: "Wire protocol: openai-compatible chat completions or the Anthropic Messages API",
  })
  @IsString()
  @IsOptional()
  @IsIn(LLM_PROVIDERS)
  provider?: string;

  @ApiProperty({ description: "Upstream model identifier, e.g. deepseek-chat, qwen-plus" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  model!: string;

  @ApiPropertyOptional({
    description:
      "Required for openai-compatible (without the /chat/completions suffix). " +
      "Optional for anthropic; leave empty to use https://api.anthropic.com.",
  })
  @IsString()
  @ValidateIf((dto) => dto.provider !== ANTHROPIC_PROVIDER)
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ["http", "https"], require_protocol: true })
  baseUrl?: string;

  @ApiProperty({
    description:
      "Upstream API key. Unique per endpoint (baseUrl): a second connection with the same key and baseUrl is rejected with 409.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey!: string;
}

export class UpdateLlmConnectionDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: LLM_PROVIDERS })
  @IsString()
  @IsOptional()
  @IsIn(LLM_PROVIDERS)
  provider?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  model?: string;

  @ApiPropertyOptional({
    description:
      "Required for openai-compatible. Optional for anthropic; send an empty " +
      "value to fall back to https://api.anthropic.com.",
  })
  @IsString()
  @ValidateIf((dto) => dto.baseUrl !== undefined && dto.provider !== ANTHROPIC_PROVIDER)
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ["http", "https"], require_protocol: true })
  baseUrl?: string;

  @ApiPropertyOptional({
    description:
      "New API key. Must stay unique per endpoint (baseUrl). Sending back the masked value from a GET response keeps the stored key unchanged.",
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey?: string;
}

export class LlmConnectionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: LLM_PROVIDERS })
  provider!: string;

  @ApiProperty()
  model!: string;

  @ApiProperty()
  baseUrl!: string;

  @ApiProperty({ description: "Always masked; the raw API key is never returned by the API." })
  apiKey!: string;

  @ApiProperty({
    isArray: true,
    description: "Consumer scopes bound to this connection (ADR-006). One scope binds to exactly one connection.",
  })
  scopes!: string[];

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: "When the last model call (any scope sharing this connection) was attempted; null = never called",
  })
  lastCallAt?: Date | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: "Outcome of the last model call; null = never called",
  })
  lastCallSuccess?: boolean | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      "Normalized failure category of the last failed call (timeout/auth/rate-limit/bad-request/payment/upstream)",
  })
  lastFailureCategory?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Upstream failure message of the last failed call, capped at 500 chars",
  })
  lastFailureMessage?: string | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class TestLlmConnectionResponseDto {
  @ApiProperty({ description: "Whether the minimal chat completion request succeeded" })
  success!: boolean;

  @ApiProperty({ description: "Human-readable test result, including a normalized failure reason" })
  message!: string;
}
