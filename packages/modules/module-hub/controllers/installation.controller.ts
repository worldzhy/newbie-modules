import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { AuditActorType } from "@modules/audit/audit-log.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";

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
  @ApiCreatedResponse()
  async create(@Body() body: CreateHubInstallationDto, @Req() request: UserRequest) {
    return this.installations.create({ ...body, actor: request.user.userId });
  }

  @Get("installations")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async list(@Query() query: ListHubInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Get("installations/:id/modules")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async modules(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.getModules(params.id);
  }

  @Put("installations/:id/target-spec")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async setTargetSpec(
    @Param() params: CommonGetByStringIdRequestDto,
    @Body() body: SetHubTargetSpecDto,
    @Req() request: UserRequest,
  ) {
    return this.installations.setTargetSpec(params.id, body.spec, request.user.userId);
  }

  @Post("installations/:id/token/regenerate")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto, @Req() request: UserRequest) {
    return this.installations.regenerateToken(params.id, request.user.userId);
  }

  @Delete("installations/:id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ModuleHubInstallation)
  @ApiOkResponse()
  async revoke(@Param() params: CommonGetByStringIdRequestDto, @Req() request: UserRequest) {
    return this.installations.revoke(params.id, request.user.userId);
  }

  // -- Catalog ---------------------------------------------------------------

  @Get("catalog")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HubModuleRelease)
  @ApiOkResponse()
  async catalog() {
    return this.releases.getCatalog();
  }

  @Get("catalog/:moduleKey/releases")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.HubModuleRelease)
  @ApiOkResponse()
  async moduleReleases(@Param("moduleKey") moduleKey: string) {
    return this.releases.getReleasesForModule(moduleKey);
  }

  /**
   * Operator-triggered catalog sync: pull the registry HEAD and ingest any
   * missing (module, commit) pairs. Repairs a missed webhook delivery; the
   * shared idempotent upsert makes re-runs no-ops.
   */
  @Post("catalog/sync")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.HubModuleRelease)
  @ApiOkResponse()
  async syncCatalog(@Req() request: UserRequest) {
    return this.releases.syncCatalogFromRegistry({
      actorType: AuditActorType.USER,
      actorId: request.user.userId,
    });
  }
}
