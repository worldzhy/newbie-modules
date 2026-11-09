import { Controller, Inject, Post, Body, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { RemoveService, type CustomDeleteFilter } from "./remove.service";
import { func, pickRequestId } from "../../shared/utils";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "../web/web-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Remove")
@Controller("/web-monitor/remove")
export class RemoveController {
  constructor(
    private readonly removeService: RemoveService,
    private readonly access: WebMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @Post("/customDeleteData")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Custom delete monitoring data (with membership gate)" })
  @ApiResponse({ type: Object })
  async customDelete(@Body() body: CustomDeleteFilter, @Req() req: UserRequest) {
    // Deletion targets the appKey the caller has already been proven to see;
    // an appKey outside that scope is a 403, not a cross-tenant write.
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.removeService.customDelete(appKey, body);
    return func.result({
      data: result,
    });
  }
}
