import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";

import { CreateHubInstallationDto, ListHubInstallationsQueryDto } from "../module-hub.dto";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Host integration API. Protected by the host's own auth layer; hub does not
 * define user models. The UI-facing grouping (project/application) is the
 * host's business — hub only stores the opaque externalRef.
 *
 * v3 alignment note: change-request endpoints were removed (no execution
 * channel in v3). The `PUT /installations/:id/target-spec` endpoint and its
 * audit action are scheduled for Phase 1 (host integration API completion).
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class InstallationsController {
  constructor(
    private readonly installations: ModuleHubInstallationService,
    private readonly releases: ModuleHubReleaseService,
  ) {}

  // -- Installations ---------------------------------------------------------

  @Post("installations")
  async create(@Body() body: CreateHubInstallationDto) {
    return this.installations.create(body);
  }

  @Get("installations")
  async list(@Query() query: ListHubInstallationsQueryDto) {
    return this.installations.list(query);
  }

  @Get("installations/:id")
  async get(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.get(params.id);
  }

  @Get("installations/:id/modules")
  async modules(@Param() params: CommonGetByStringIdRequestDto) {
    return this.installations.getModules(params.id);
  }

  @Post("installations/:id/token/regenerate")
  async regenerateToken(@Param() params: CommonGetByStringIdRequestDto, @Query("actor") actor?: string) {
    return this.installations.regenerateToken(params.id, actor);
  }

  @Delete("installations/:id")
  async revoke(@Param() params: CommonGetByStringIdRequestDto, @Query("actor") actor?: string) {
    return this.installations.revoke(params.id, actor);
  }

  // -- Catalog ---------------------------------------------------------------

  @Get("catalog")
  async catalog() {
    return this.releases.getCatalog();
  }

  @Get("catalog/:moduleKey/releases")
  async moduleReleases(@Param("moduleKey") moduleKey: string) {
    return this.releases.getReleasesForModule(moduleKey);
  }
}
