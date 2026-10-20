import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

import { CreateHealthInstallationDto, ListHealthInstallationsQueryDto } from "../health.dto";
import { HealthInstallationService } from "../services/installation.service";

/**
 * Host integration API. Protected by the host's own auth layer; the module
 * does not define user models. The UI-facing grouping (project/application)
 * is the host's business — the module only stores the opaque externalRef.
 */
@ApiTags("Health")
@Controller("health")
export class InstallationController {
  constructor(private readonly installations: HealthInstallationService) {}

  @Post("installations")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.HealthInstallation)
  async create(@Body() body: CreateHealthInstallationDto) {
    return this.installations.create(body);
  }

  @Get("installations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HealthInstallation)
  async list(@Query() query: ListHealthInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.HealthInstallation)
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Post("installations/:id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.HealthInstallation)
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.regenerateToken(params.id);
  }

  @Delete("installations/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.HealthInstallation)
  async revoke(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.revoke(params.id);
  }
}
