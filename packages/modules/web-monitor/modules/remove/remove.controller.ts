import { BadRequestException, Controller, Post, Body, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { RemoveService, type CustomDeleteFilter } from "./remove.service";
import { func, pickRequestId } from "../../shared/utils";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "../web/web-monitor-access.service";

@ApiTags("Frontend Monitor / Remove")
@Controller("/web-monitor/remove")
export class RemoveController {
  constructor(
    private readonly removeService: RemoveService,
    private readonly access: WebMonitorAccessService,
  ) {}

  @Post("/customDeleteData")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Custom delete monitoring data (with project membership gate)" })
  @ApiResponse({ type: Object })
  async customDelete(
    @Body() body: CustomDeleteFilter & { projectId?: string; applicationId?: string },
    @Req() req: UserRequest,
  ) {
    const projectId = pickRequestId(req, "projectId");
    const applicationId = pickRequestId(req, "applicationId");
    if (!projectId || !applicationId) {
      throw new BadRequestException("projectId and applicationId are required");
    }
    // Deletion targets the installation's immutable partition key, never an
    // appKey supplied by the caller: otherwise a project A admin could wipe
    // project B's telemetry by sending B's appKey alongside their own project.
    const appKey = await this.access.resolveAppKey(projectId, applicationId, req.user.userId);
    const result = await this.removeService.customDelete(appKey, body);
    return func.result({
      data: result,
    });
  }
}
