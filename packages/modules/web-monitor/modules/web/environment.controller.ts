import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { EnvironmentService } from "./services/environment.service";
import { WebMonitorEnvironmentGroupByItemResponseDto, WebMonitorEnvironmentResponseDto } from "./environment.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";

@ApiTags("Frontend Monitor / Web / Environment")
@Controller("/web-monitor/environment")
export class EnvironmentController {
  constructor(
    private readonly envSrv: EnvironmentService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getDataGroupBy")
  @ApiOperation({ summary: "Get environment data grouped by type" })
  @ApiResponse({ type: WebMonitorEnvironmentGroupByItemResponseDto, isArray: true })
  async getDataGroupBy(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url, beginTime, endTime, type = 1 } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.envSrv.getDataGroupBy(
      Number(type),
      String(url),
      appKey,
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getEnvironmentForPage")
  @ApiOperation({ summary: "Get environment info for a page" })
  @ApiResponse({ type: WebMonitorEnvironmentResponseDto })
  async getEnvironmentForPage(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, markPage } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!markPage) throw new BadRequestException("markPage is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.envSrv.getEnvironmentForPage(appKey, String(markPage));
    return func.result({ data: result });
  }
}
