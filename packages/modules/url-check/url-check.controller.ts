import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { UrlCheckService } from "./url-check.service";
import {
  CreateUrlMonitorTargetDto,
  DeleteUrlMonitorTargetResponseDto,
  ListUrlMonitorTargetsRequestDto,
  UpdateUrlMonitorTargetDto,
  UrlMonitorCheckResultDto,
  UrlMonitorIncidentDto,
  UrlMonitorTargetDto,
  UrlMonitorTargetStatsDto,
  UrlMonitorTargetStatsRequestDto,
} from "./url-check.dto";

/**
 * Administration of url-check targets.
 *
 * Scope resolution is host-owned (see newbie-modules ADR-017): this module
 * declares no scope keys. The host lists `UrlMonitorTarget` in
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
  @RequirePermission(PermissionAction.List, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "List URL check targets of a project" })
  @ApiOkResponse({ type: UrlMonitorTargetDto, isArray: true })
  async list(@Query() query: ListUrlMonitorTargetsRequestDto): Promise<UrlMonitorTargetDto[]> {
    return this.urlCheck.list(query.projectId);
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Add an external URL to the availability check" })
  @ApiCreatedResponse({ type: UrlMonitorTargetDto })
  async create(@Body() body: CreateUrlMonitorTargetDto, @Req() request: UserRequest): Promise<UrlMonitorTargetDto> {
    return this.urlCheck.create(body, request.user.userId);
  }

  @Get(":targetId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Get one URL check target" })
  @ApiOkResponse({ type: UrlMonitorTargetDto })
  async getById(@Param("targetId") targetId: string): Promise<UrlMonitorTargetDto> {
    return this.urlCheck.getById(targetId);
  }

  @Patch(":targetId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Rename, re-point, pause or resume a URL check target" })
  @ApiOkResponse({ type: UrlMonitorTargetDto })
  async update(
    @Param("targetId") targetId: string,
    @Body() body: UpdateUrlMonitorTargetDto,
  ): Promise<UrlMonitorTargetDto> {
    return this.urlCheck.update(targetId, body);
  }

  @Delete(":targetId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Remove a URL check target" })
  @ApiOkResponse({ type: DeleteUrlMonitorTargetResponseDto })
  async delete(@Param("targetId") targetId: string): Promise<DeleteUrlMonitorTargetResponseDto> {
    return this.urlCheck.delete(targetId);
  }

  @Get(":targetId/check-results")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Recent raw check results of one target (newest first)" })
  @ApiOkResponse({ type: UrlMonitorCheckResultDto, isArray: true })
  async listCheckResults(
    @Param("targetId") targetId: string,
    @Query("limit") limit?: string,
  ): Promise<UrlMonitorCheckResultDto[]> {
    return this.urlCheck.listCheckResults(targetId, limit);
  }

  @Get(":targetId/incidents")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Outage incidents of one target, newest first" })
  @ApiOkResponse({ type: UrlMonitorIncidentDto, isArray: true })
  async listIncidents(
    @Param("targetId") targetId: string,
    @Query("limit") limit?: string,
  ): Promise<UrlMonitorIncidentDto[]> {
    return this.urlCheck.listIncidents(targetId, limit);
  }

  @Get(":targetId/stats")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.UrlMonitorTarget)
  @ApiOperation({ summary: "Availability, MTTR and latency stats over a trailing window" })
  @ApiOkResponse({ type: UrlMonitorTargetStatsDto })
  async getStats(
    @Param("targetId") targetId: string,
    @Query() query?: UrlMonitorTargetStatsRequestDto,
  ): Promise<UrlMonitorTargetStatsDto> {
    return this.urlCheck.getStats(targetId, query?.window);
  }
}
