import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

import { CreateHeartbeatInstallationDto, ListHeartbeatInstallationsQueryDto } from "../heartbeat.dto";
import { HeartbeatInstallationService } from "../services/installation.service";

/**
 * Host integration API. Protected by the host's own auth layer; the module
 * does not define user models. The UI-facing grouping (project/application)
 * is the host's business — the module only stores the opaque externalRef.
 */
@ApiTags("Heartbeat")
@Controller("heartbeat")
export class InstallationController {
  constructor(private readonly installations: HeartbeatInstallationService) {}

  @Post("installations")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.HeartbeatInstallation)
  async create(@Body() body: CreateHeartbeatInstallationDto) {
    return this.installations.create(body);
  }

  @Get("installations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HeartbeatInstallation)
  async list(@Query() query: ListHeartbeatInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.HeartbeatInstallation)
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Post("installations/:id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.HeartbeatInstallation)
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.regenerateToken(params.id);
  }

  @Delete("installations/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.HeartbeatInstallation)
  async revoke(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.revoke(params.id);
  }
}
