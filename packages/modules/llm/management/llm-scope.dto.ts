import { ApiProperty } from "@nestjs/swagger";

/**
 * One scope-to-connection binding (ADR-006). Shared response shape for every
 * /llm/scopes endpoint so list, bind and unbind all report the resulting
 * binding with its target connection info.
 */
export class LlmScopeBindingResponseDto {
  @ApiProperty({ example: "copilot", description: "Opaque consumer scope" })
  scope!: string;

  @ApiProperty({ format: "uuid", description: "ID of the connection the scope is bound to" })
  connectionId!: string;

  @ApiProperty({ description: "Display name of the bound connection" })
  connectionName!: string;

  @ApiProperty({ description: "Upstream model ID of the bound connection" })
  connectionModel!: string;
}
