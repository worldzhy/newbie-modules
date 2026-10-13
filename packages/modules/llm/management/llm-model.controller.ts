import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  ActivateLlmModelResponseDto,
  CreateLlmModelDto,
  LlmModelResponseDto,
  TestLlmModelResponseDto,
  UpdateLlmModelDto,
} from "./llm-model.dto";
import { LlmModelService } from "./llm-model.service";

/**
 * Admin endpoints for the unified LLM model registry. Authorization follows
 * the existing model-management precedent: the global authentication guard
 * requires a logged-in session, while route-level admin permission is managed
 * by the frontend navigation and the platform-wide authorization guards.
 */
@ApiTags("LLM Model Admin")
@ApiBearerAuth()
@Controller("llm/models")
export class LlmModelController {
  constructor(private readonly llmModelService: LlmModelService) {}

  @Get()
  @ApiOperation({ summary: "List all configured LLM models across scopes (keys masked)" })
  @ApiResponse({ status: 200, type: [LlmModelResponseDto] })
  async list(): Promise<LlmModelResponseDto[]> {
    return await this.llmModelService.list();
  }

  @Post()
  @ApiOperation({ summary: "Create an LLM model for a scope (inactive until activated)" })
  @ApiBody({ type: CreateLlmModelDto })
  @ApiResponse({ status: 201, type: LlmModelResponseDto })
  async create(@Body() dto: CreateLlmModelDto): Promise<LlmModelResponseDto> {
    return await this.llmModelService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an LLM model; echoing the masked key keeps it unchanged" })
  @ApiBody({ type: UpdateLlmModelDto })
  @ApiResponse({ status: 200, type: LlmModelResponseDto })
  async update(@Param("id") id: string, @Body() dto: UpdateLlmModelDto): Promise<LlmModelResponseDto> {
    return await this.llmModelService.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an LLM model (the active one of its scope cannot be deleted)" })
  @ApiResponse({ status: 200, type: LlmModelResponseDto })
  async remove(@Param("id") id: string): Promise<LlmModelResponseDto> {
    return await this.llmModelService.remove(id);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Make this model the active LLM model for its scope" })
  @ApiResponse({ status: 201, type: ActivateLlmModelResponseDto })
  async activate(@Param("id") id: string): Promise<ActivateLlmModelResponseDto> {
    return await this.llmModelService.activate(id);
  }

  @Post(":id/test")
  @ApiOperation({ summary: "Test model connectivity with a minimal chat completion request" })
  @ApiResponse({ status: 200, type: TestLlmModelResponseDto })
  async test(@Param("id") id: string): Promise<TestLlmModelResponseDto> {
    return await this.llmModelService.test(id);
  }
}
