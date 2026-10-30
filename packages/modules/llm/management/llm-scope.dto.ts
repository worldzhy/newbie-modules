import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/** Body of PATCH /llm/scopes/:scope — the connection the scope switches to. */
export class BindLlmScopeDto {
  @ApiProperty({ format: "uuid", description: "ID of the LlmConnection to bind this scope to" })
  @IsUUID()
  connectionId!: string;
}

/**
 * One scope in the admin catalog with its current binding (ADR-043). A scope is
 * always listed, bound or not; the connection fields are null while unbound.
 */
export class LlmScopeBindingResponseDto {
  @ApiProperty({ example: "copilot", description: "Opaque consumer scope" })
  scope!: string;

  @ApiProperty({ description: "Human-readable consumer name declared together with the scope" })
  label!: string;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    description: "ID of the bound connection; null while the scope is unbound",
  })
  connectionId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Display name of the bound connection",
  })
  connectionName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Upstream model ID of the bound connection",
  })
  connectionModel!: string | null;
}
