import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func, pickRequestId } from "../../shared/utils";
import { ErrorService } from "./services/error.service";
import {
  ListFrontendMonitorErrorsResponseDto,
  ListFrontendMonitorErrorMarkUsersResponseDto,
  ListFrontendMonitorErrorOnesResponseDto,
} from "./error.dto";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / Error")
@Controller("/frontend-monitor/error")
export class ErrorController {
  constructor(
    private readonly errorSrv: ErrorService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getAverageErrorList")
  @ApiOperation({ summary: "Get average error category list" })
  @ApiResponse({ type: ListFrontendMonitorErrorsResponseDto })
  async getAverageErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.errorSrv.getAverageErrorList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getOneErrorList")
  @ApiOperation({ summary: "Get single error resource list" })
  @ApiResponse({ type: ListFrontendMonitorErrorOnesResponseDto })
  async getOneErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { url } = q;
    if (!url) throw new BadRequestException("url is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const resolved = { ...q, appKey: appKey };
    const result = await this.errorSrv.getOneErrorList(resolved);
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getMarkUserErrorList")
  @ApiOperation({ summary: "Get marked user error list" })
  @ApiResponse({ type: ListFrontendMonitorErrorMarkUsersResponseDto })
  async getMarkUserErrorList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { markUser } = q;
    if (!markUser) throw new BadRequestException("markUser is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.errorSrv.getMarkUserErrorListCH(appKey, {
      markUser: String(markUser),
      beginTime: q.beginTime as string | undefined,
      endTime: q.endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
