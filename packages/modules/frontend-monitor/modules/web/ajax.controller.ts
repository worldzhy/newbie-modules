import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { AjaxService } from "./services/ajax.service";
import {
  ListFrontendMonitorAjaxAveragesResponseDto,
  ListFrontendMonitorAjaxMarkUsersResponseDto,
  ListFrontendMonitorAjaxOnesResponseDto,
} from "./ajax.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Ajax")
@Controller("/frontend-monitor/ajax")
export class AjaxController {
  constructor(
    private readonly ajax: AjaxService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getPageAjaxsAvg")
  @ApiOperation({ summary: "Get page ajax average performance" })
  @ApiResponse({ type: ListFrontendMonitorAjaxAveragesResponseDto })
  async getPageAjaxsAvg(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, beginTime, endTime } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.ajax.getPageAjaxsAvg(
      appKey,
      String(url),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getAverageAjaxList")
  @ApiOperation({ summary: "Get average ajax performance list" })
  @ApiResponse({ type: ListFrontendMonitorAjaxAveragesResponseDto })
  async getAverageAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.ajax.getAverageAjaxList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getOneAjaxList")
  @ApiOperation({ summary: "Get single ajax average performance data" })
  @ApiResponse({ type: ListFrontendMonitorAjaxOnesResponseDto })
  async getOneAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, pageNo = 1, pageSize = 15, beginTime, endTime, type } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
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

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getMarkUserAjaxList")
  @ApiOperation({ summary: "Get marked user ajax list" })
  @ApiResponse({ type: ListFrontendMonitorAjaxMarkUsersResponseDto })
  async getMarkUserAjaxList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { markUser, beginTime, endTime } = q;
    if (!markUser) throw new BadRequestException("markUser is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.ajax.getMarkUserAjaxList(appKey, {
      markUser: String(markUser),
      beginTime: beginTime as string | undefined,
      endTime: endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
