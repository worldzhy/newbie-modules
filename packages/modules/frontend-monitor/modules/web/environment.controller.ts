import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { EnvironmentService } from "./services/environment.service";
import {
  FrontendMonitorEnvironmentGroupByItemResponseDto,
  FrontendMonitorEnvironmentResponseDto,
} from "./environment.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Environment")
@Controller("/frontend-monitor/environment")
export class EnvironmentController {
  constructor(
    private readonly envSrv: EnvironmentService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getDataGroupBy")
  @ApiOperation({ summary: "Get environment data grouped by type" })
  @ApiResponse({ type: FrontendMonitorEnvironmentGroupByItemResponseDto, isArray: true })
  async getDataGroupBy(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url, beginTime, endTime, type = 1 } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.envSrv.getDataGroupBy(
      Number(type),
      String(url),
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getEnvironmentForPage")
  @ApiOperation({ summary: "Get environment info for a page" })
  @ApiResponse({ type: FrontendMonitorEnvironmentResponseDto })
  async getEnvironmentForPage(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { markPage } = q;
    if (!markPage) throw new BadRequestException("markPage is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.envSrv.getEnvironmentForPage(appKey, String(markPage));
    return func.result({ data: result });
  }
}
