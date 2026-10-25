import { Body, Controller, Delete, Get, Param, Post, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

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
  @ApiCreatedResponse()
  async create(@Body() body: CreateHealthInstallationDto, @Req() request: UserRequest) {
    return this.installations.create(body, request.user.userId);
  }

  @Get("installations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HealthInstallation)
  @ApiOkResponse()
  async list(@Query() query: ListHealthInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.HealthInstallation)
  @ApiOkResponse()
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Post("installations/:id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.HealthInstallation)
  @ApiOkResponse()
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto, @Req() request: UserRequest) {
    return this.installations.regenerateToken(params.id, request.user.userId);
  }

  @Delete("installations/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.HealthInstallation)
  @ApiOkResponse()
  async revoke(@Param() params: CommonGetByStringIdRequestDto, @Req() request: UserRequest) {
    return this.installations.revoke(params.id, request.user.userId);
  }
}
