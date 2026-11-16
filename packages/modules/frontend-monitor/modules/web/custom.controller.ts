import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { func, pickRequestId } from "../../shared/utils";
import { WebCustomService } from "./services/custom.service";
import {
  ListFrontendMonitorCustomAveragesResponseDto,
  ListFrontendMonitorCustomFiltersResponseDto,
} from "./custom.dto";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Custom")
@Controller("/frontend-monitor/custom")
export class CustomController {
  constructor(
    private readonly webCustom: WebCustomService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @Get("filters")
  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @ApiOperation({ summary: "Get custom filter list" })
  @ApiResponse({ type: ListFrontendMonitorCustomFiltersResponseDto })
  async getCustomFilterList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.webCustom.getCustomFilterList(appKey);
    return func.result({ data: result });
  }

  @Post("filters")
  @RequirePermission(PermissionAction.Create, "FrontendMonitorSite")
  @ApiOperation({ summary: "Add a custom filter" })
  @ApiResponse({ type: Boolean })
  async addCustomFilter(@Body() body: Record<string, unknown>, @Req() req: UserRequest) {
    const { filterKey, filterDesc } = body;
    if (!filterKey) throw new BadRequestException("filterKey is required");
    if (!filterDesc) throw new BadRequestException("filterDesc is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const ok = await this.webCustom.addCustomFilter(appKey, filterKey as string, filterDesc as string);
    return func.result({ data: ok });
  }

  @Delete("filters/:filterId")
  @RequirePermission(PermissionAction.Delete, "FrontendMonitorSite")
  @ApiOperation({ summary: "Delete a custom filter" })
  @ApiResponse({ type: Boolean })
  async delCustomFilter(@Param("filterId") filterId: string, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const ok = await this.webCustom.delCustomFilter(appKey, filterId);
    return func.result({ data: ok });
  }

  @Get("averages")
  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @ApiOperation({ summary: "Get average custom category list" })
  @ApiResponse({ type: ListFrontendMonitorCustomAveragesResponseDto })
  async getAverageCustomList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { pageNo = 1, pageSize = 15, beginTime, endTime, customName, customFilter } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
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
