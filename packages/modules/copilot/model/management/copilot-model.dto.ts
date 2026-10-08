import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from "class-validator";
import { ANTHROPIC_PROVIDER, COPILOT_PROVIDERS } from "./copilot-providers";

export class CreateCopilotModelDto {
  @ApiProperty({ description: "User-friendly display name for this model" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    enum: COPILOT_PROVIDERS,
    default: "openai-compatible",
    description: "Wire protocol: openai-compatible chat completions or the Anthropic Messages API",
  })
  @IsString()
  @IsOptional()
  @IsIn(COPILOT_PROVIDERS)
  provider?: string;

  @ApiProperty({ description: "Upstream model identifier, e.g. deepseek-chat, qwen-plus" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  model: string;

  @ApiProperty({
    description:
      "Required for openai-compatible (without the /chat/completions suffix). " +
      "Optional for anthropic; leave empty to use https://api.anthropic.com.",
  })
  // ValidateIf (not IsOptional) guards this: an undefined/missing baseUrl must
  // fail for openai-compatible while being allowed to pass for anthropic.
  @IsString()
  @ValidateIf((dto) => dto.provider !== ANTHROPIC_PROVIDER)
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ["http", "https"], require_protocol: true })
  baseUrl?: string;

  @ApiProperty({ description: "Upstream API key" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey: string;
}

export class UpdateCopilotModelDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: COPILOT_PROVIDERS })
  @IsString()
  @IsOptional()
  @IsIn(COPILOT_PROVIDERS)
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
  // Only validate when a value is present and the target protocol needs it:
  // omitted = unchanged, anthropic = empty allowed, openai-compatible = URL.
  @IsString()
  @ValidateIf((dto) => dto.baseUrl !== undefined && dto.provider !== ANTHROPIC_PROVIDER)
  @IsNotEmpty()
  @IsUrl({ require_tld: false, protocols: ["http", "https"], require_protocol: true })
  baseUrl?: string;

  @ApiPropertyOptional({
    description: "New API key. Sending back the masked value from a GET response keeps the stored key unchanged.",
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey?: string;
}

export class CopilotModelResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: COPILOT_PROVIDERS })
  provider: string;

  @ApiProperty()
  model: string;

  @ApiProperty()
  baseUrl: string;

  @ApiProperty({
    description: "Always masked; the raw API key is never returned by the API.",
  })
  apiKey: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class ActivateCopilotModelResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ description: "ID of the newly active model" })
  activeModelId: string;
}

export class TestCopilotModelResponseDto {
  @ApiProperty({ description: "Whether the minimal chat completion request succeeded" })
  success: boolean;

  @ApiProperty({ description: "Human-readable test result, including a normalized failure reason" })
  message: string;
}
