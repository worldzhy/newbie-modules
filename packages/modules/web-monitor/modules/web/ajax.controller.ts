import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { AjaxService } from "./services/ajax.service";
import {
  ListWebMonitorAjaxAveragesResponseDto,
  ListWebMonitorAjaxMarkUsersResponseDto,
  ListWebMonitorAjaxOnesResponseDto,
} from "./ajax.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";
import { PROJECT_VISIBLE_IDS_RESOLVER, ProjectVisibleIdsResolver } from "../../shared/project-visible-ids.port";

@ApiTags("Frontend Monitor / Web / Ajax")
@Controller("/web-monitor/ajax")
export class AjaxController {
  constructor(
    private readonly ajax: AjaxService,
    private readonly access: WebMonitorAccessService,
    @Inject(PROJECT_VISIBLE_IDS_RESOLVER)
    private readonly projectVisibility: ProjectVisibleIdsResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPageAjaxsAvg")
  @ApiOperation({ summary: "Get page ajax average performance" })
  @ApiResponse({ type: ListWebMonitorAjaxAveragesResponseDto })
  async getPageAjaxsAvg(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.ajax.getPageAjaxsAvg(
      appKey,
      String(url),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAverageAjaxList")
  @ApiOperation({ summary: "Get average ajax performance list" })
  @ApiResponse({ type: ListWebMonitorAjaxAveragesResponseDto })
  async getAverageAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const resolved = { ...q, appKey: appKey };
    const result = await this.ajax.getAverageAjaxList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOneAjaxList")
  @ApiOperation({ summary: "Get single ajax average performance data" })
  @ApiResponse({ type: ListWebMonitorAjaxOnesResponseDto })
  async getOneAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, pageNo = 1, pageSize = 15, beginTime, endTime, type } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.ajax.getOneAjaxList(
      appKey,
      String(url),
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
      Number(type),
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getMarkUserAjaxList")
  @ApiOperation({ summary: "Get marked user ajax list" })
  @ApiResponse({ type: ListWebMonitorAjaxMarkUsersResponseDto })
  async getMarkUserAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, markUser, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!markUser) throw new BadRequestException("markUser is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.ajax.getMarkUserAjaxList(appKey, {
      markUser: String(markUser),
      beginTime: beginTime as string | undefined,
      endTime: endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
