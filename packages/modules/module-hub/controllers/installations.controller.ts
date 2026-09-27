import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CommonGetByStringIdRequestDto } from "@devbie/newbie/common.dto";

import {
  CreateHubChangeRequestDto,
  CreateHubInstallationDto,
  ListHubChangeRequestsQueryDto,
  ListHubInstallationsQueryDto,
} from "../module-hub.dto";
import { ModuleHubChangeRequestService } from "../services/change-request.service";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Host integration API. Protected by the host's own auth layer; hub does not
 * define user models. The UI-facing grouping (project/application) is the
 * host's business — hub only stores the opaque externalRef.
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class InstallationsController {
  constructor(
    private readonly installations: ModuleHubInstallationService,
    private readonly releases: ModuleHubReleaseService,
    private readonly changes: ModuleHubChangeRequestService,
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

  // -- Change requests -------------------------------------------------------

  @Get("installations/:id/change-requests")
  async listChangeRequests(
    @Param() params: CommonGetByStringIdRequestDto,
    @Query() query: ListHubChangeRequestsQueryDto,
  ) {
    return this.changes.list(params.id, query);
  }

  @Post("installations/:id/change-requests")
  async createChangeRequest(@Param() params: CommonGetByStringIdRequestDto, @Body() body: CreateHubChangeRequestDto) {
    return this.changes.create(params.id, body);
  }
}
