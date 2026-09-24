import {Controller, Get, Post, Patch, Delete, Param, Body, HttpException, HttpStatus} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {IsString, IsNotEmpty, IsOptional, IsIn} from 'class-validator';
import {LlmAgentService} from './llm-agent.service';

// Supported LLM provider keys, mirroring the Prisma `LlmProvider` enum.
const LLM_PROVIDERS: string[] = ['qwen', 'openai', 'deepseek', 'claude'];

export class SwitchProviderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  providerId: string;
}

export class CreateLlmModelDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({enum: LLM_PROVIDERS})
  @IsString()
  @IsNotEmpty()
  @IsIn(LLM_PROVIDERS)
  provider: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  baseUrl: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  version?: string;
}

export class UpdateLlmModelDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({enum: LLM_PROVIDERS})
  @IsString()
  @IsOptional()
  @IsIn(LLM_PROVIDERS)
  provider?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  model?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  apiKey?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  version?: string;
}

// --- Response DTOs (no class-validator decorators: validation applies to inbound payloads only) ---

export class LlmModelDto {
  @ApiProperty({description: 'Model record ID (uuid)'})
  id: string;

  @ApiProperty({description: 'User-friendly model name'})
  name: string;

  @ApiProperty({enum: LLM_PROVIDERS, description: 'LLM provider key'})
  provider: string;

  @ApiProperty({description: 'Upstream model identifier, e.g. gpt-4o, deepseek-chat'})
  model: string;

  @ApiProperty({description: 'Upstream API base URL'})
  baseUrl: string;

  @ApiProperty({description: 'API key, always masked (********xxxx) in responses; the raw value is never returned'})
  apiKey: string;

  @ApiPropertyOptional({description: 'Optional provider-specific version, e.g. Claude 2023-06-01', type: String})
  version?: string | null;

  @ApiProperty({description: 'Whether this model is the currently active one'})
  isActive: boolean;

  @ApiProperty({type: Date, description: 'Creation timestamp (ISO after serialization)'})
  createdAt: Date;

  @ApiProperty({type: Date, description: 'Last update timestamp (ISO after serialization)'})
  updatedAt: Date;
}

export class LlmProviderInfoDto {
  @ApiProperty({description: 'Model record ID used when switching provider'})
  id: string;

  @ApiProperty({description: 'User-friendly model name'})
  name: string;

  @ApiProperty({description: 'Whether the model has an API key and can be called'})
  isAvailable: boolean;

  @ApiPropertyOptional({description: 'Upstream model identifier', type: String})
  model?: string;

  @ApiPropertyOptional({description: 'LLM provider key', enum: LLM_PROVIDERS})
  providerType?: string;
}

export class GetLlmProvidersResponseDto {
  @ApiPropertyOptional({description: 'ID of the currently active model, null when none is active', type: String})
  currentProvider?: string | null;

  @ApiProperty({type: [LlmProviderInfoDto], description: 'Configured models exposed as switchable providers'})
  providers: LlmProviderInfoDto[];
}

export class SwitchLlmProviderResponseDto {
  @ApiProperty({description: 'Always true when the switch succeeds'})
  success: boolean;

  @ApiProperty({description: 'ID of the newly active model'})
  currentProvider: string;
}

export class TestLlmModelResponseDto {
  @ApiProperty({description: 'Whether the ping call succeeded'})
  success: boolean;

  @ApiProperty({description: 'Human-readable test result message'})
  message: string;
}

@ApiTags('LLM Agent')
@ApiBearerAuth()
@Controller('llm')
export class LlmAgentController {
  constructor(private readonly llmAgentService: LlmAgentService) {}

  @Get('providers')
  @ApiOperation({summary: 'Get list of available LLM providers'})
  @ApiResponse({status: 200, type: GetLlmProvidersResponseDto})
  async getProviders(): Promise<GetLlmProvidersResponseDto> {
    return {
      currentProvider: await this.llmAgentService.getCurrentProvider(),
      providers: await this.llmAgentService.getAvailableProviders(),
    };
  }

  @Post('provider/switch')
  @ApiOperation({summary: 'Switch the active LLM provider dynamically'})
  @ApiBody({type: SwitchProviderDto})
  @ApiResponse({status: 200, type: SwitchLlmProviderResponseDto})
  @ApiResponse({status: 400, description: 'Provider not supported or unavailable.'})
  async switchProvider(@Body() body: SwitchProviderDto): Promise<SwitchLlmProviderResponseDto> {
    if (!body || !body.providerId) {
      throw new HttpException('providerId is required', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.llmAgentService.switchProvider(body.providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('models')
  @ApiOperation({summary: 'Get all LLM models'})
  @ApiResponse({status: 200, type: [LlmModelDto]})
  async getModels(): Promise<LlmModelDto[]> {
    return await this.llmAgentService.getModels();
  }

  @Post('models')
  @ApiOperation({summary: 'Create a new LLM model'})
  @ApiResponse({status: 200, type: LlmModelDto})
  async createModel(@Body() dto: CreateLlmModelDto): Promise<LlmModelDto> {
    return await this.llmAgentService.createModel(dto);
  }

  @Patch('models/:id')
  @ApiOperation({summary: 'Update an LLM model'})
  @ApiResponse({status: 200, type: LlmModelDto})
  async updateModel(@Param('id') id: string, @Body() dto: UpdateLlmModelDto): Promise<LlmModelDto> {
    return await this.llmAgentService.updateModel(id, dto);
  }

  @Delete('models/:id')
  @ApiOperation({summary: 'Delete an LLM model'})
  @ApiResponse({status: 200, type: LlmModelDto})
  async deleteModel(@Param('id') id: string): Promise<LlmModelDto> {
    return await this.llmAgentService.deleteModel(id);
  }

  @Post('models/:id/test')
  @ApiOperation({summary: 'Test an LLM model connection'})
  @ApiResponse({status: 200, type: TestLlmModelResponseDto})
  async testModel(@Param('id') id: string): Promise<TestLlmModelResponseDto> {
    return await this.llmAgentService.testModel(id);
  }
}
