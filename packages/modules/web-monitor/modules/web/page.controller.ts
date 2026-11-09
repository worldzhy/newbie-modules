import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { PageService } from "./services/page.service";
import {
  ListWebMonitorPageAveragesResponseDto,
  WebMonitorPageDetailResponseDto,
  ListWebMonitorPageVisitsResponseDto,
  WebMonitorRealTimePageItemResponseDto,
} from "./page.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Pages")
@Controller("/web-monitor/pages")
export class PageController {
  constructor(
    private readonly pageSrv: PageService,
    private readonly access: WebMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAveragePageList")
  @ApiOperation({ summary: "Get average page performance list" })
  @ApiResponse({ type: ListWebMonitorPageAveragesResponseDto })
  async getAveragePageList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.pageSrv.getAveragePageList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getRealTimeAveragePageList")
  @ApiOperation({ summary: "Get real-time average page performance list" })
  @ApiResponse({ type: WebMonitorRealTimePageItemResponseDto, isArray: true })
  async getRealTimeAveragePageList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    if (!beginTime || !endTime) throw new BadRequestException("beginTime and endTime are required");
    if (func.toDate(endTime).getTime() - func.toDate(beginTime).getTime() > 60000 * 60) {
      throw new BadRequestException("the interval between beginTime and endTime must not exceed one hour");
    }
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const data = await this.pageSrv.getRealTimeAveragePageList(resolved);
    return func.result({ data });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOnePageList")
  @ApiOperation({ summary: "Get single page performance or visit list" })
  @ApiResponse({ type: ListWebMonitorPageVisitsResponseDto })
  async getOnePageList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.pageSrv.getOnePageList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPageDetails")
  @ApiOperation({ summary: "Get single page details" })
  @ApiResponse({ type: WebMonitorPageDetailResponseDto })
  async getPageDetails(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { id } = q;
    if (!id) throw new BadRequestException("id is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const row = await this.pageSrv.getPageDetails(appKey, String(id));
    return func.result({ data: row || {} });
  }
}
