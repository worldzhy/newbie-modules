import { Controller, Post, Body } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction } from "@generated/prisma/client";
import { RemoveService, type CustomDeleteFilter } from "./remove.service";
import { func } from "../../shared/utils";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

@ApiTags("Frontend Monitor / Remove")
@Controller("/web-monitor/remove")
export class RemoveController {
  constructor(private readonly removeService: RemoveService) {}

  @Post("/customDeleteData")
  @RequirePermission(PermissionAction.Delete, "WebMonitorSite")
  @ApiOperation({ summary: "Custom delete monitoring data" })
  @ApiResponse({ type: Object })
  async customDelete(@Body() body: CustomDeleteFilter) {
    const result = await this.removeService.customDelete(body);
    return func.result({
      data: result,
    });
  }
}
