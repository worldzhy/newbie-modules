import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { WebMonitorAnalysisService } from "./services/analysis.service";
import {
  ListWebMonitorAnalysisUsersResponseDto,
  WebMonitorProvinceCountResponseDto,
  WebMonitorWebTopDatasResponseDto,
} from "./analysis.dto";
import { WebMonitorEnvironmentResponseDto } from "./environment.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";

@ApiTags("Frontend Monitor / Web / Analysis")
@Controller("/web-monitor/analysis")
export class WebMonitorAnalysisController {
  constructor(
    private readonly analysisService: WebMonitorAnalysisService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAnalysislist")
  @ApiOperation({ summary: "Get user funnel analysis list" })
  @ApiResponse({ type: ListWebMonitorAnalysisUsersResponseDto })
  async getAnalysislist(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime, uid, phone } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.analysisService.getAnalysislist(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
      { uid: uid as string | undefined, phone: phone as string | undefined },
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAnalysisOneList")
  @ApiOperation({ summary: "Get single user behavior track list" })
  @ApiResponse({ type: WebMonitorEnvironmentResponseDto, isArray: true })
  async getAnalysisOneList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, markUser } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!markUser) throw new BadRequestException("markUser is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.analysisService.getAnalysisOneList(appKey, String(markUser));
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getTopDatas")
  @ApiOperation({ summary: "Get top data statistics" })
  @ApiResponse({ type: WebMonitorWebTopDatasResponseDto })
  async getTopDatas(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const data = await this.analysisService.getTopDatas(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getProvinceCount")
  @ApiOperation({ summary: "Get province count statistics" })
  @ApiResponse({ type: WebMonitorProvinceCountResponseDto })
  async getProvinceCount(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.analysisService.getProvinceCount(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }
}
