import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { func } from "../../shared/utils";
import { WebCustomService } from "./services/custom.service";
import { ListWebMonitorCustomAveragesResponseDto, ListWebMonitorCustomFiltersResponseDto } from "./custom.dto";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";
import { PROJECT_VISIBLE_IDS_RESOLVER, ProjectVisibleIdsResolver } from "../../shared/project-visible-ids.port";

@ApiTags("Frontend Monitor / Web / Custom")
@Controller("/web-monitor/custom")
export class CustomController {
  constructor(
    private readonly webCustom: WebCustomService,
    private readonly access: WebMonitorAccessService,
    @Inject(PROJECT_VISIBLE_IDS_RESOLVER)
    private readonly projectVisibility: ProjectVisibleIdsResolver,
  ) {}

  @Get("/getCustomFilterList")
  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @ApiOperation({ summary: "Get custom filter list" })
  @ApiResponse({ type: ListWebMonitorCustomFiltersResponseDto })
  async getCustomFilterList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.webCustom.getCustomFilterList(appKey);
    return func.result({ data: result });
  }

  @Post("/addCustomFilter")
  @RequirePermission(PermissionAction.Create, "WebMonitorSite")
  @ApiOperation({ summary: "Add a custom filter" })
  @ApiResponse({ type: Boolean })
  async addCustomFilter(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, filterKey, filterDesc } = body;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!filterKey) throw new BadRequestException("filterKey is required");
    if (!filterDesc) throw new BadRequestException("filterDesc is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const ok = await this.webCustom.addCustomFilter(appKey, filterKey as string, filterDesc as string);
    return func.result({ data: ok });
  }

  @Post("/delCustomFilter")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Delete a custom filter" })
  @ApiResponse({ type: Boolean })
  async delCustomFilter(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, _id } = body;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!_id) throw new BadRequestException("_id is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const ok = await this.webCustom.delCustomFilter(appKey, _id as string);
    return func.result({ data: ok });
  }

  @Get("/getAverageCustomList")
  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @ApiOperation({ summary: "Get average custom category list" })
  @ApiResponse({ type: ListWebMonitorCustomAveragesResponseDto })
  async getAverageCustomList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, pageNo = 1, pageSize = 15, beginTime, endTime, customName, customFilter } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.webCustom.getAverageCustomList(
      appKey,
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
      customName as string | undefined,
      customFilter as Record<string, unknown> | undefined,
    );
    return func.result({ data: result });
  }
}
