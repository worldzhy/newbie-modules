import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

import { CreateMonitorInstallationDto, ListMonitorInstallationsQueryDto } from "../monitor-installation.dto";
import { MonitorInstallationService } from "../services/monitor-installation.service";

/**
 * Host integration API for backend-monitor installations (module-hub design
 * §9.2). Protected by the platform JWT guard (ingest itself is @NoGuard and
 * token-only). The plaintext report token is returned exactly once:
 * POST create / POST token/regenerate responses.
 */
@ApiTags("backend-monitor")
@ApiBearerAuth()
@Controller("backend-monitor/installations")
export class InstallationController {
  constructor(private readonly installations: MonitorInstallationService) {}

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.BackendMonitorInstallation)
  @ApiOperation({ summary: "Enroll a backend-monitor deployment installation" })
  @ApiCreatedResponse()
  create(@Body() body: CreateMonitorInstallationDto, @Req() request: UserRequest) {
    return this.installations.create(body, request.user.userId);
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.BackendMonitorInstallation)
  @ApiOperation({ summary: "List backend-monitor installations" })
  @ApiOkResponse()
  list(@Query() query: ListMonitorInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.BackendMonitorInstallation)
  @ApiOperation({ summary: "Get one backend-monitor installation" })
  @ApiOkResponse()
  get(@Param("id") id: string) {
    return this.installations.get(id);
  }

  @Post(":id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.BackendMonitorInstallation)
  @ApiOperation({ summary: "Rotate the report token (plaintext returned once)" })
  @ApiOkResponse()
  regenerate(@Param("id") id: string, @Req() request: UserRequest) {
    return this.installations.regenerateToken(id, request.user.userId);
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.BackendMonitorInstallation)
  @ApiOperation({ summary: "Revoke an installation; subsequent ingest gets 401" })
  @ApiOkResponse()
  revoke(@Param("id") id: string, @Req() request: UserRequest) {
    return this.installations.revoke(id, request.user.userId);
  }
}
