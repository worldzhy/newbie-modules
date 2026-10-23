import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { UrlCheckService } from "./url-check.service";
import {
  CreateUrlCheckTargetDto,
  DeleteUrlCheckTargetResponseDto,
  ListUrlCheckTargetsRequestDto,
  UpdateUrlCheckTargetDto,
  UrlCheckResultDto,
  UrlCheckIncidentDto,
  UrlCheckTargetDto,
  UrlCheckTargetStatsDto,
  UrlCheckTargetStatsRequestDto,
} from "./url-check.dto";

/**
 * Administration of url-check targets.
 *
 * Scope resolution is host-owned (see newbie-modules ADR-017): this module
 * declares no scope keys. The host lists `UrlCheckTarget` in
 * HOST_SCOPED_RESOURCES and registers resolvers in priority order — the
 * target-id resolver maps single-target routes to their owning project, and
 * the project resolver covers collection routes that carry projectId.
 */
@ApiTags("url-check")
@ApiBearerAuth()
@Controller("url-check-targets")
export class UrlCheckController {
  constructor(private readonly urlCheck: UrlCheckService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "List URL check targets of a project" })
  @ApiOkResponse({ type: UrlCheckTargetDto, isArray: true })
  async list(@Query() query: ListUrlCheckTargetsRequestDto): Promise<UrlCheckTargetDto[]> {
    return this.urlCheck.list(query.projectId);
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Add an external URL to the availability check" })
  @ApiCreatedResponse({ type: UrlCheckTargetDto })
  async create(@Body() body: CreateUrlCheckTargetDto, @Req() request: UserRequest): Promise<UrlCheckTargetDto> {
    return this.urlCheck.create(body, request.user.userId);
  }

  @Get(":targetId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Get one URL check target" })
  @ApiOkResponse({ type: UrlCheckTargetDto })
  async getById(@Param("targetId") targetId: string): Promise<UrlCheckTargetDto> {
    return this.urlCheck.getById(targetId);
  }

  @Patch(":targetId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Rename, re-point, pause or resume a URL check target" })
  @ApiOkResponse({ type: UrlCheckTargetDto })
  async update(@Param("targetId") targetId: string, @Body() body: UpdateUrlCheckTargetDto): Promise<UrlCheckTargetDto> {
    return this.urlCheck.update(targetId, body);
  }

  @Delete(":targetId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Remove a URL check target" })
  @ApiOkResponse({ type: DeleteUrlCheckTargetResponseDto })
  async delete(@Param("targetId") targetId: string): Promise<DeleteUrlCheckTargetResponseDto> {
    return this.urlCheck.delete(targetId);
  }

  @Get(":targetId/check-results")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Recent raw check results of one target (newest first)" })
  @ApiOkResponse({ type: UrlCheckResultDto, isArray: true })
  async listCheckResults(
    @Param("targetId") targetId: string,
    @Query("limit") limit?: string,
  ): Promise<UrlCheckResultDto[]> {
    return this.urlCheck.listCheckResults(targetId, limit);
  }

  @Get(":targetId/incidents")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Outage incidents of one target, newest first" })
  @ApiOkResponse({ type: UrlCheckIncidentDto, isArray: true })
  async listIncidents(
    @Param("targetId") targetId: string,
    @Query("limit") limit?: string,
  ): Promise<UrlCheckIncidentDto[]> {
    return this.urlCheck.listIncidents(targetId, limit);
  }

  @Get(":targetId/stats")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlCheckTarget)
  @ApiOperation({ summary: "Availability, MTTR and latency stats over a trailing window" })
  @ApiOkResponse({ type: UrlCheckTargetStatsDto })
  async getStats(
    @Param("targetId") targetId: string,
    @Query() query?: UrlCheckTargetStatsRequestDto,
  ): Promise<UrlCheckTargetStatsDto> {
    return this.urlCheck.getStats(targetId, query?.window);
  }
}
