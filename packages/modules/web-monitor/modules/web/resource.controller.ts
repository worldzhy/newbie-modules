import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { ResourceService } from "./services/resource.service";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";

@ApiTags("Frontend Monitor / Web / Resource")
@Controller("/web-monitor/resource")
export class ResourceController {
  constructor(
    private readonly resourceSrv: ResourceService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getResourceForType")
  @ApiOperation({ summary: "Get resource performance list by type" })
  @ApiResponse({ type: Object })
  async getResourceForType(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, type = 1, pageNo = 1, pageSize = 15, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
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

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAverageResourceList")
  @ApiOperation({ summary: "Get average resource performance list" })
  @ApiResponse({ type: Object })
  async getAverageResourceList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const resolved = { ...q, appId: appKey };
    const result = await this.resourceSrv.getAverageResourceList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOneResourceAvg")
  @ApiOperation({ summary: "Get single resource average performance" })
  @ApiResponse({ type: Object })
  async getOneResourceAvg(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.resourceSrv.getOneResourceAvg(
      appKey,
      String(url),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOneResourceList")
  @ApiOperation({ summary: "Get single resource performance list" })
  @ApiResponse({ type: Object })
  async getOneResourceList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, pageNo = 1, pageSize = 15, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
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

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOneResourceDetail")
  @ApiOperation({ summary: "Get single resource details" })
  @ApiResponse({ type: Object })
  async getOneResourceDetail(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, id } = q;
    if (!id) throw new BadRequestException("id is required");
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const row = await this.resourceSrv.getOneResourceDetail(appKey, String(id));
    return func.result({ data: row || {} });
  }
}
