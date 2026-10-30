import { Body, Controller, Delete, Get, Param, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { BindLlmScopeDto, LlmScopeBindingResponseDto } from "./llm-scope.dto";
import { LlmScopeService } from "./llm-scope.service";

/**
 * Admin endpoints for scope-to-connection bindings (ADR-006, catalog ADR-043).
 *
 * The scope catalog is declared by consumers and exposed read-only here; the
 * admin only chooses which connection serves each scope. Binding changes take
 * effect on the next consumer call.
 */
@ApiTags("LLM Scope Bindings")
@ApiBearerAuth()
@Controller("llm/scopes")
export class LlmScopeController {
  constructor(private readonly scopes: LlmScopeService) {}

  @Get()
  @RequirePermission(PermissionAction.List, "LlmScopeAssignment")
  @ApiOperation({ summary: "List every consumer scope with its binding (unbound scopes included)" })
  @ApiResponse({ status: 200, type: [LlmScopeBindingResponseDto] })
  async list(): Promise<LlmScopeBindingResponseDto[]> {
    return await this.scopes.list();
  }

  @Patch(":scope")
  @RequirePermission(PermissionAction.Update, "LlmScopeAssignment")
  @ApiOperation({ summary: "Bind a consumer scope to an LLM connection (upsert)" })
  @ApiParam({ name: "scope", description: "Scope registered by a consumer", example: "copilot" })
  @ApiBody({ type: BindLlmScopeDto })
  @ApiResponse({ status: 200, type: LlmScopeBindingResponseDto })
  @ApiResponse({ status: 400, description: "Unknown scope (not declared by any consumer)" })
  @ApiResponse({ status: 404, description: "Connection not found" })
  async bind(@Param("scope") scope: string, @Body() dto: BindLlmScopeDto): Promise<LlmScopeBindingResponseDto> {
    return await this.scopes.bind(scope, dto.connectionId);
  }

  @Delete(":scope")
  @RequirePermission(PermissionAction.Delete, "LlmScopeAssignment")
  @ApiOperation({ summary: "Remove the binding for a consumer scope (the scope's consumer will stop working)" })
  @ApiResponse({ status: 200, type: LlmScopeBindingResponseDto })
  async unbind(@Param("scope") scope: string): Promise<LlmScopeBindingResponseDto> {
    return await this.scopes.unbind(scope);
  }
}
