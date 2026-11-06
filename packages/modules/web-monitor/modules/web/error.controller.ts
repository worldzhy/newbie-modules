import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { ErrorService } from "./services/error.service";
import {
  ListWebMonitorErrorsResponseDto,
  ListWebMonitorErrorMarkUsersResponseDto,
  ListWebMonitorErrorOnesResponseDto,
} from "./error.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";

@ApiTags("Frontend Monitor / Web / Error")
@Controller("/web-monitor/error")
export class ErrorController {
  constructor(
    private readonly errorSrv: ErrorService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getAverageErrorList")
  @ApiOperation({ summary: "Get average error category list" })
  @ApiResponse({ type: ListWebMonitorErrorsResponseDto })
  async getAverageErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const resolved = { ...q, appId: appKey };
    const result = await this.errorSrv.getAverageErrorList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getOneErrorList")
  @ApiOperation({ summary: "Get single error resource list" })
  @ApiResponse({ type: ListWebMonitorErrorOnesResponseDto })
  async getOneErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, url } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!url) throw new BadRequestException("url is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const resolved = { ...q, appId: appKey };
    const result = await this.errorSrv.getOneErrorList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getMarkUserErrorList")
  @ApiOperation({ summary: "Get marked user error list" })
  @ApiResponse({ type: ListWebMonitorErrorMarkUsersResponseDto })
  async getMarkUserErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, markUser } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!markUser) throw new BadRequestException("markUser is required");
    const appKey = await this.access.resolveAppKey(String(projectId), String(applicationId), req.user.userId);
    const result = await this.errorSrv.getMarkUserErrorListCH(appKey, {
      markUser: String(markUser),
      beginTime: q.beginTime as string | undefined,
      endTime: q.endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
