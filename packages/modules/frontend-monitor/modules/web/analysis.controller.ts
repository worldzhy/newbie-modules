import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { FrontendMonitorAnalysisService } from "./services/analysis.service";
import {
  ListFrontendMonitorAnalysisUsersResponseDto,
  FrontendMonitorProvinceCountResponseDto,
  FrontendMonitorWebTopDatasResponseDto,
} from "./analysis.dto";
import { FrontendMonitorEnvironmentResponseDto } from "./environment.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Analysis")
@Controller("/frontend-monitor/analysis")
export class FrontendMonitorAnalysisController {
  constructor(
    private readonly analysisService: FrontendMonitorAnalysisService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getAnalysislist")
  @ApiOperation({ summary: "Get user funnel analysis list" })
  @ApiResponse({ type: ListFrontendMonitorAnalysisUsersResponseDto })
  async getAnalysislist(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime, uid, phone } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.analysisService.getAnalysislist(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
      { uid: uid as string | undefined, phone: phone as string | undefined },
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getAnalysisOneList")
  @ApiOperation({ summary: "Get single user behavior track list" })
  @ApiResponse({ type: FrontendMonitorEnvironmentResponseDto, isArray: true })
  async getAnalysisOneList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { markUser } = q;
    if (!markUser) throw new BadRequestException("markUser is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.analysisService.getAnalysisOneList(appKey, String(markUser));
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getTopDatas")
  @ApiOperation({ summary: "Get top data statistics" })
  @ApiResponse({ type: FrontendMonitorWebTopDatasResponseDto })
  async getTopDatas(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const data = await this.analysisService.getTopDatas(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getProvinceCount")
  @ApiOperation({ summary: "Get province count statistics" })
  @ApiResponse({ type: FrontendMonitorProvinceCountResponseDto })
  async getProvinceCount(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.analysisService.getProvinceCount(
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }
}
