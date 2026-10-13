import { Body, Controller, Delete, Get, Param, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { LlmScopeService } from "./llm-scope.service";

/**
 * Admin endpoints for scope-to-connection bindings (ADR-006).
 *
 * One scope binds to exactly one connection; a connection can serve many
 * scopes. Binding changes take effect on the next consumer call.
 */
@ApiTags("LLM Scope Bindings")
@ApiBearerAuth()
@Controller("llm/scopes")
export class LlmScopeController {
  constructor(private readonly scopes: LlmScopeService) {}

  @Get()
  @ApiOperation({ summary: "List all scope-to-connection bindings" })
  @ApiResponse({
    status: 200,
    description: "List of scope bindings with their target connection info",
  })
  async list(): Promise<Array<{ scope: string; connectionId: string; connectionName: string; connectionModel: string }>> {
    return await this.scopes.list();
  }

  @Patch(":scope")
  @RequirePermission("manage", "LlmScopeAssignment")
  @ApiOperation({ summary: "Bind a consumer scope to an LLM connection (upsert)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["connectionId"],
      properties: {
        connectionId: { type: "string", description: "UUID of the LlmConnection to bind this scope to" },
      },
    },
  })
  async bind(
    @Param("scope") scope: string,
    @Body("connectionId") connectionId: string,
  ): Promise<{ scope: string; connectionId: string }> {
    if (!connectionId) {
      throw new Error("connectionId is required");
    }
    await this.scopes.bind(scope, connectionId);
    return { scope, connectionId };
  }

  @Delete(":scope")
  @RequirePermission("manage", "LlmScopeAssignment")
  @ApiOperation({ summary: "Remove the binding for a consumer scope (the scope's consumer will stop working)" })
  async unbind(@Param("scope") scope: string): Promise<{ scope: string }> {
    await this.scopes.unbind(scope);
    return { scope };
  }
}
