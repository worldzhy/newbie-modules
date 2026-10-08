import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  ActivateCopilotModelResponseDto,
  CopilotModelResponseDto,
  CreateCopilotModelDto,
  TestCopilotModelResponseDto,
  UpdateCopilotModelDto,
} from "./copilot-model.dto";
import { CopilotModelService } from "./copilot-model.service";

/**
 * Admin endpoints for the Web Copilot model registry. Authorization follows
 * the existing model-management precedent: the global authentication guard
 * requires a logged-in session, while route-level admin permission is managed
 * by the frontend navigation and the platform-wide authorization guards.
 */
@ApiTags("Copilot Model Admin")
@ApiBearerAuth()
@Controller("copilot/models")
export class CopilotModelController {
  constructor(private readonly copilotModelService: CopilotModelService) {}

  @Get()
  @ApiOperation({ summary: "List all configured Copilot models (keys masked)" })
  @ApiResponse({ status: 200, type: [CopilotModelResponseDto] })
  async list(): Promise<CopilotModelResponseDto[]> {
    return await this.copilotModelService.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a Copilot model (inactive until activated)" })
  @ApiBody({ type: CreateCopilotModelDto })
  @ApiResponse({ status: 201, type: CopilotModelResponseDto })
  async create(@Body() dto: CreateCopilotModelDto): Promise<CopilotModelResponseDto> {
    return await this.copilotModelService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a Copilot model; echoing the masked key keeps it unchanged" })
  @ApiBody({ type: UpdateCopilotModelDto })
  @ApiResponse({ status: 200, type: CopilotModelResponseDto })
  async update(@Param("id") id: string, @Body() dto: UpdateCopilotModelDto): Promise<CopilotModelResponseDto> {
    return await this.copilotModelService.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a Copilot model (the active one cannot be deleted)" })
  @ApiResponse({ status: 200, type: CopilotModelResponseDto })
  async remove(@Param("id") id: string): Promise<CopilotModelResponseDto> {
    return await this.copilotModelService.remove(id);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Make this model the globally active Copilot model" })
  @ApiResponse({ status: 201, type: ActivateCopilotModelResponseDto })
  async activate(@Param("id") id: string): Promise<ActivateCopilotModelResponseDto> {
    return await this.copilotModelService.activate(id);
  }

  @Post(":id/test")
  @ApiOperation({ summary: "Test model connectivity with a minimal chat completion request" })
  @ApiResponse({ status: 200, type: TestCopilotModelResponseDto })
  async test(@Param("id") id: string): Promise<TestCopilotModelResponseDto> {
    return await this.copilotModelService.test(id);
  }
}
