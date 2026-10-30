import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { ChatModelResolver } from "../chat-model.resolver";
import { ModelCallError } from "../chat-model.port";
import {
  CreateLlmConnectionDto,
  LlmConnectionResponseDto,
  TestLlmConnectionDto,
  TestLlmConnectionResponseDto,
  UpdateLlmConnectionDto,
} from "./llm-connection.dto";
import { LlmConnectionService } from "./llm-connection.service";

const TEST_TIMEOUT_MS = 15_000;

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
  constructor(
    private readonly connections: LlmConnectionService,
    private readonly resolver: ChatModelResolver,
  ) {}

  @Get()
  @RequirePermission(PermissionAction.List, "LlmConnection")
  @ApiOperation({ summary: "List all LLM connections with their bound scopes (keys masked)" })
  @ApiResponse({ status: 200, type: [LlmConnectionResponseDto] })
  async list(): Promise<LlmConnectionResponseDto[]> {
    return await this.connections.list();
  }

  @Post()
  @RequirePermission(PermissionAction.Create, "LlmConnection")
  @ApiOperation({ summary: "Create an LLM connection (not yet bound to any scope)" })
  @ApiBody({ type: CreateLlmConnectionDto })
  @ApiResponse({ status: 201, type: LlmConnectionResponseDto })
  async create(@Body() dto: CreateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    return await this.connections.create(dto);
  }

  @Patch(":id")
  @RequirePermission(PermissionAction.Update, "LlmConnection")
  @ApiOperation({ summary: "Update an LLM connection; echoing the masked key keeps it unchanged" })
  @ApiBody({ type: UpdateLlmConnectionDto })
  @ApiResponse({ status: 200, type: LlmConnectionResponseDto })
  async update(@Param("id") id: string, @Body() dto: UpdateLlmConnectionDto): Promise<LlmConnectionResponseDto> {
    return await this.connections.update(id, dto);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, "LlmConnection")
  @ApiOperation({ summary: "Delete an LLM connection; all scope bindings are removed (cascade)" })
  @ApiResponse({ status: 200, type: LlmConnectionResponseDto })
  async remove(@Param("id") id: string): Promise<LlmConnectionResponseDto> {
    return await this.connections.remove(id);
  }

  @Post("test")
  @RequirePermission(PermissionAction.Create, "LlmConnection")
  @ApiOperation({
    summary: "Test a connection configuration with a minimal chat completion request (nothing is persisted)",
  })
  @ApiBody({ type: TestLlmConnectionDto })
  @ApiResponse({ status: 200, type: TestLlmConnectionResponseDto })
  async test(@Body() dto: TestLlmConnectionDto): Promise<TestLlmConnectionResponseDto> {
    // The admin dialog uses this for both the create and edit forms, so the
    // probe runs against exactly the values on screen rather than the stored
    // row. A masked apiKey echo (edit form left untouched) is resolved to the
    // stored key via `id`.
    const apiKey = await this.connections.resolveTestApiKey(dto.id, dto.apiKey);
    const port = this.resolver.createDraftPort({
      provider: dto.provider,
      model: dto.model,
      baseUrl: dto.baseUrl ?? "",
      apiKey,
    });
    try {
      await port.complete({
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      return { success: true, message: "Connection successful." };
    } catch (error) {
      if (error instanceof ModelCallError) {
        return { success: false, message: testFailureMessage(error) };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }
}

/** Maps a ModelCallError from the test call to a user-facing message. */
function testFailureMessage(error: ModelCallError): string {
  switch (error.category) {
    case "timeout":
      return `Connection timed out after ${TEST_TIMEOUT_MS / 1000}s.`;
    case "auth":
      return "Authentication failed: the API key was rejected (401/403).";
    case "rate-limit":
      return "Rate limited by the upstream provider (429); try again later.";
    case "payment":
      return `Payment/quota issue: ${error.message}`;
    case "bad-request":
      return `The upstream provider rejected the request: ${error.message}`;
    default:
      return error.message || "The upstream model API returned an error.";
  }
}
