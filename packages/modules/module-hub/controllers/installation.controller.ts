import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

import { CreateHubInstallationDto, ListHubInstallationsQueryDto, SetHubTargetSpecDto } from "../module-hub.dto";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Host integration API. Protected by the host's own auth layer; hub does not
 * define user models. The UI-facing grouping (project/application) is the
 * host's business — hub only stores the opaque externalRef.
 *
 * v3 alignment (Phase 1): change-request endpoints removed (no execution
 * channel in v3); PUT /installations/:id/target-spec stores pure data,
 * audited as "installation.target-spec". GET /installations/:id/modules
 * returns the reported snapshot plus the read-time "target vs actual"
 * comparison (Phase 2 convergence view).
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class InstallationController {
  constructor(
    private readonly installations: ModuleHubInstallationService,
    private readonly releases: ModuleHubReleaseService,
  ) {}

  // -- Installations ---------------------------------------------------------

  @Post("installations")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ModuleHubInstallation)
  async create(@Body() body: CreateHubInstallationDto) {
    return this.installations.create(body);
  }

  @Get("installations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.ModuleHubInstallation)
  async list(@Query() query: ListHubInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ModuleHubInstallation)
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Get("installations/:id/modules")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ModuleHubInstallation)
  async modules(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.getModules(params.id);
  }

  @Put("installations/:id/target-spec")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ModuleHubInstallation)
  async setTargetSpec(
    @Param() params: CommonGetByStringIdRequestDto,
    @Body() body: SetHubTargetSpecDto,
    @Query("actor") actor?: string,
  ) {
    return this.installations.setTargetSpec(params.id, body.spec, actor);
  }

  @Post("installations/:id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ModuleHubInstallation)
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto, @Query("actor") actor?: string) {
    return this.installations.regenerateToken(params.id, actor);
  }

  @Delete("installations/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ModuleHubInstallation)
  async revoke(@Param() params: CommonGetByStringIdRequestDto, @Query("actor") actor?: string) {
    return this.installations.revoke(params.id, actor);
  }

  // -- Catalog ---------------------------------------------------------------

  @Get("catalog")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HubModuleRelease)
  async catalog() {
    return this.releases.getCatalog();
  }

  @Get("catalog/:moduleKey/releases")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HubModuleRelease)
  async moduleReleases(@Param("moduleKey") moduleKey: string) {
    return this.releases.getReleasesForModule(moduleKey);
  }
}
