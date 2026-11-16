import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { ResourceService } from "./services/resource.service";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Resource")
@Controller("/frontend-monitor/resource")
export class ResourceController {
  constructor(
    private readonly resourceSrv: ResourceService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("types")
  @ApiOperation({ summary: "Get resource performance list by type" })
  @ApiResponse({ type: Object })
  async getResourceForType(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, type = 1, pageNo = 1, pageSize = 15, beginTime, endTime } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.resourceSrv.getResourceForType(
      appKey,
      String(url),
      Number(type),
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("averages")
  @ApiOperation({ summary: "Get average resource performance list" })
  @ApiResponse({ type: Object })
  async getAverageResourceList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.resourceSrv.getAverageResourceList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("average")
  @ApiOperation({ summary: "Get single resource average performance" })
  @ApiResponse({ type: Object })
  async getOneResourceAvg(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, beginTime, endTime } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.resourceSrv.getOneResourceAvg(
      appKey,
      String(url),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("ones")
  @ApiOperation({ summary: "Get single resource performance list" })
  @ApiResponse({ type: Object })
  async getOneResourceList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, pageNo = 1, pageSize = 15, beginTime, endTime } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.resourceSrv.getOneResourceList(
      appKey,
      String(url),
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get(":resourceId")
  @ApiOperation({ summary: "Get single resource details" })
  @ApiResponse({ type: Object })
  async getOneResourceDetail(@Param("resourceId") resourceId: string, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const row = await this.resourceSrv.getOneResourceDetail(appKey, resourceId);
    return func.result({ data: row || {} });
  }
}
