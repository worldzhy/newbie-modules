import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import {
  CreateMonitorInstallationDto,
  ListMonitorInstallationsQueryDto,
} from "../monitor-installation.dto";
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
export class BackendMonitorInstallationsController {
  constructor(private readonly installations: MonitorInstallationService) {}

  @Post()
  @ApiOperation({ summary: "Enroll a backend-monitor deployment installation" })
  create(@Body() body: CreateMonitorInstallationDto) {
    return this.installations.create(body);
  }

  @Get()
  @ApiOperation({ summary: "List backend-monitor installations" })
  list(@Query() query: ListMonitorInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one backend-monitor installation" })
  get(@Param("id") id: string) {
    return this.installations.get(id);
  }

  @Post(":id/token/regenerate")
  @ApiOperation({ summary: "Rotate the report token (plaintext returned once)" })
  regenerate(@Param("id") id: string) {
    return this.installations.regenerateToken(id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke an installation; subsequent ingest gets 401" })
  revoke(@Param("id") id: string) {
    return this.installations.revoke(id);
  }
}
