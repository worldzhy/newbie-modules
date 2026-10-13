import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  CreateLlmConnectionDto,
  LlmConnectionResponseDto,
  TestLlmConnectionResponseDto,
  UpdateLlmConnectionDto,
} from "./llm-connection.dto";
import { LlmConnectionService } from "./llm-connection.service";

/**
 * Admin endpoints for the LLM connection registry (ADR-006).
 *
 * Read access to GET /llm/connections is granted to any authenticated session
 * (API keys are masked; dock header and model-health dot depend on this).
 * Write endpoints require the ADMIN role via the global AuthorizationGuard.
 */
@ApiTags("LLM Connection Admin")
@ApiBearerAuth()
@Controller("llm/connections")
export class LlmConnectionController {
  constructor(private readonly connections: LlmConnectionService) {}

  @Get()
  @ApiOperation({ summary: "List all LLM connections with their bound scopes (keys masked)" })
  @ApiResponse({ status: 200, type: [LlmConnectionResponseDto] })
  async list(): Promise<LlmConnectionResponseDto[]> {
    return await this.connections.list();
  }

  @Post()
  @RequirePermission("create", "LlmConnection")
  @ApiOperation({ summary: "Create an LLM connection (not yet bound to any scope)" })
  @ApiBody({ type: CreateLlmConnectionDto })
  @ApiResponse({ status: 201, type: LlmConnectionResponseDto })
  async create(@Body() dto: CreateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    return await this.connections.create(dto);
  }

  @Patch(":id")
  @RequirePermission("update", "LlmConnection")
  @ApiOperation({ summary: "Update an LLM connection; echoing the masked key keeps it unchanged" })
  @ApiBody({ type: UpdateLlmConnectionDto })
  @ApiResponse({ status: 200, type: LlmConnectionResponseDto })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateLlmConnectionDto,
  ): Promise<LlmConnectionResponseDto> {
    return await this.connections.update(id, dto);
  }

  @Delete(":id")
  @RequirePermission("delete", "LlmConnection")
  @ApiOperation({ summary: "Delete an LLM connection; all scope bindings are removed (cascade)" })
  @ApiResponse({ status: 200, type: LlmConnectionResponseDto })
  async remove(@Param("id") id: string): Promise<LlmConnectionResponseDto> {
    return await this.connections.remove(id);
  }

  @Post(":id/test")
  @RequirePermission("manage", "LlmConnection")
  @ApiOperation({ summary: "Test connection with a minimal chat completion request (shared adapter path)" })
  @ApiResponse({ status: 200, type: TestLlmConnectionResponseDto })
  async test(@Param("id") id: string): Promise<TestLlmConnectionResponseDto> {
    return await this.connections.test(id);
  }
}
