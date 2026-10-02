import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ApiKey, Prisma } from "@generated/prisma/client";
import { CursorPipe } from "@devbie/newbie/pipes/cursor.pipe";
import { OrderByPipe } from "@devbie/newbie/pipes/order-by.pipe";
import { WherePipe } from "@devbie/newbie/pipes/where.pipe";
import { Expose } from "../../helpers/expose";
import { SelfOnlyGuard } from "../../security/self-only/self-only.guard";
import { ApiKeyResponseDto, CreateApiKeyDto, ReplaceApiKeyDto, UpdateApiKeyDto } from "./api-key.dto";
import { ApiKeyService } from "./api-key.service";

@ApiTags("Account / Api Key")
@ApiBearerAuth()
@UseGuards(SelfOnlyGuard)
@Controller("users/:userId/api-keys")
export class ApiKeyController {
  constructor(private apiKeyService: ApiKeyService) {}

  /** Create an API key for the current user */
  @Post()
  @ApiOperation({ summary: "Create an API key for a user" })
  @ApiResponse({ type: ApiKeyResponseDto })
  async create(
    @Param("userId") userId: string,
    @Body() data: CreateApiKeyDto,
  ): Promise<Expose<ApiKey> & { secret: string }> {
    return await this.apiKeyService.createApiKey({ userId, data });
  }

  /** Get API keys for the current user */
  @Get()
  @ApiOperation({ summary: "Get API keys for a user" })
  @ApiResponse({ type: ApiKeyResponseDto, isArray: true })
  async getAll(
    @Param("userId") userId: string,
    @Query("skip") skip?: number,
    @Query("take") take?: number,
    @Query("cursor", CursorPipe) cursor?: Prisma.ApiKeyWhereUniqueInput,
    @Query("where", WherePipe) where?: Record<string, number | string>,
    @Query("orderBy", OrderByPipe) orderBy?: Record<string, "asc" | "desc">,
  ): Promise<Expose<ApiKey>[]> {
    return await this.apiKeyService.getApiKeysForUser(userId, {
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get an API key */
  @Get(":id")
  @ApiOperation({ summary: "Get an API key by id" })
  @ApiResponse({ type: ApiKeyResponseDto })
  async get(@Param("userId") userId: string, @Param("id") id: number): Promise<Expose<ApiKey>> {
    return await this.apiKeyService.getApiKeyForUser(userId, id);
  }

  /** Update an API key */
  @Patch(":id")
  @ApiOperation({ summary: "Update an API key" })
  @ApiResponse({ type: ApiKeyResponseDto })
  async update(
    @Param("userId") userId: string,
    @Body() data: UpdateApiKeyDto,
    @Param("id") id: number,
  ): Promise<Expose<ApiKey>> {
    return await this.apiKeyService.updateApiKey(userId, id, data);
  }

  /** Replace an API key */
  @Put(":id")
  @ApiOperation({ summary: "Replace an API key" })
  @ApiResponse({ type: ApiKeyResponseDto })
  async replace(
    @Param("userId") userId: string,
    @Body() data: ReplaceApiKeyDto,
    @Param("id") id: number,
  ): Promise<Expose<ApiKey>> {
    return await this.apiKeyService.updateApiKey(userId, id, data);
  }

  /** Delete an API key */
  @Delete(":id")
  @ApiOperation({ summary: "Delete an API key" })
  @ApiResponse({ type: ApiKeyResponseDto })
  async remove(@Param("userId") userId: string, @Param("id") id: number): Promise<Expose<ApiKey>> {
    return await this.apiKeyService.deleteApiKey(userId, id);
  }

  /** Get logs for an API key */
  @Get(":id/logs")
  @ApiOperation({ summary: "Get logs for an API key" })
  @ApiResponse({ type: Object, isArray: true })
  async getLogs(
    @Param("userId") userId: string,
    @Param("id") id: number,
    @Query("take") take?: number,
    @Query("cursor", CursorPipe) cursor?: Record<string, number | string>,
    @Query("where", WherePipe) where?: Record<string, number | string>,
  ): Promise<Record<string, unknown>[]> {
    return await this.apiKeyService.getApiKeyLogs(userId, id, {
      take,
      cursor,
      where,
    });
  }
}
