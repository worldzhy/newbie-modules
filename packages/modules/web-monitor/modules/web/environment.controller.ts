import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { EnvironmentService } from "./services/environment.service";
import { WebMonitorEnvironmentGroupByItemResponseDto, WebMonitorEnvironmentResponseDto } from "./environment.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

@ApiTags("Frontend Monitor / Web / Environment")
@Controller("/web-monitor/environment")
export class EnvironmentController {
  constructor(private readonly envSrv: EnvironmentService) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getDataGroupBy")
  @ApiOperation({ summary: "Get environment data grouped by type" })
  @ApiResponse({ type: WebMonitorEnvironmentGroupByItemResponseDto, isArray: true })
  async getDataGroupBy(@Query() q: Record<string, unknown>) {
    const { appId, url, beginTime, endTime, type = 1 } = q;
    if (!appId) throw new Error("Page performance list: appId must not be empty");
    if (!url) throw new Error("Page performance list: url must not be empty");
    const result = await this.envSrv.getDataGroupBy(
      Number(type),
      String(url),
      String(appId),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getEnvironmentForPage")
  @ApiOperation({ summary: "Get environment info for a page" })
  @ApiResponse({ type: WebMonitorEnvironmentResponseDto })
  async getEnvironmentForPage(@Query() q: Record<string, unknown>) {
    const { appId, markPage } = q;
    if (!appId) throw new Error("Get user system info by markPage: appId must not be empty");
    if (!markPage) throw new Error("Get user system info by markPage: markPage must not be empty");
    const result = await this.envSrv.getEnvironmentForPage(String(appId), String(markPage));
    return func.result({ data: result });
  }
}
