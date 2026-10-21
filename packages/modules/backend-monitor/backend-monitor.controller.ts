import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from "@nestjs/common";
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { BackendMonitorService } from "./backend-monitor.service";
import { ResolvedMonitorToken } from "./monitor-token.resolver";
import {
  CreateBackendMonitorIngestDto,
  ListBackendMonitorErrorLogsRequestDto,
  ListBackendMonitorErrorLogsResponseDto,
  ListBackendMonitorRequestLogsRequestDto,
  ListBackendMonitorRequestLogsResponseDto,
} from "./backend-monitor.dto";

@ApiTags("Backend Monitor")
@Controller("backend-monitor")
export class BackendMonitorController {
  constructor(private readonly backendMonitorService: BackendMonitorService) {}

  /**
   * Batched ingestion endpoint for backend applications (ADR-016).
   * Authentication is the BackendMonitorInstallation report token presented
   * as `Authorization: Bearer <token>` (X-Backend-Monitor-Token is a
   * deprecated alias during the SDK migration window), resolved by the
   * InstallationAuthGuard. One call carries request metrics and/or errors,
   * enabling at most one insert per table.
   */
  @ApiOperation({ summary: "Ingest a batch of backend request/error events" })
  @ApiHeader({
    name: "X-Backend-Monitor-Token",
    description: "Deprecated alias; prefer Authorization: Bearer <token>",
    required: false,
  })
  @ApiResponse({ status: 204, description: "Batch accepted." })
  @ApiResponse({ status: 400, description: "Empty batch or invalid event payload." })
  @ApiResponse({ status: 401, description: "Invalid or missing monitor installation token." })
  @ApiResponse({ status: 413, description: "An event array exceeds the batch limit." })
  @HttpCode(HttpStatus.NO_CONTENT)
  @InstallationAuth("backend-monitor")
  @AllowAnyOrigin()
  @Post("ingest")
  async ingest(
    @Req() req: Request & { installation: ResolvedMonitorToken },
    @Body() body: CreateBackendMonitorIngestDto,
  ): Promise<void> {
    await this.backendMonitorService.ingest(req.installation, body);
  }

  /**
   * Paginated request logs for one application. Backs the monitoring UI list;
   * keeps the legacy query contract (applicationId/page/pageSize/keyword/
   * sortField/sortOrder) and snake_case row shape.
   */
  @ApiOperation({ summary: "List backend request logs for an application" })
  @ApiResponse({ status: 200, type: ListBackendMonitorRequestLogsResponseDto })
  @Get("request-logs")
  @RequirePermission(PermissionAction.List, "BackendMonitorLog")
  async listRequestLogs(@Query() query: ListBackendMonitorRequestLogsRequestDto) {
    return await this.backendMonitorService.listRequestLogs(query);
  }

  /** Paginated error logs for one application. */
  @ApiOperation({ summary: "List backend error logs for an application" })
  @ApiResponse({ status: 200, type: ListBackendMonitorErrorLogsResponseDto })
  @Get("error-logs")
  @RequirePermission(PermissionAction.List, "BackendMonitorLog")
  async listErrorLogs(@Query() query: ListBackendMonitorErrorLogsRequestDto) {
    return await this.backendMonitorService.listErrorLogs(query);
  }
}
