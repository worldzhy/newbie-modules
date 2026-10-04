import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { EnvironmentService } from "./services/environment.service";
import { WebMonitorEnvironmentGroupByItemResponseDto, WebMonitorEnvironmentResponseDto } from "./environment.dto";

@ApiTags("Frontend Monitor / Web / Environment")
@Controller("/api/v1/environment")
export class EnvironmentController {
  constructor(private readonly envSrv: EnvironmentService) {}

  @Get("/getDataGroupBy")
  @ApiOperation({ summary: "Get environment data grouped by type" })
  @ApiResponse({ type: WebMonitorEnvironmentGroupByItemResponseDto, isArray: true })
  async getDataGroupBy(@Query() q: any) {
    const { appId, url, beginTime, endTime, type = 1 } = q;
    if (!appId) throw new Error("Page performance list: appId must not be empty");
    if (!url) throw new Error("Page performance list: url must not be empty");
    const result = await this.envSrv.getDataGroupBy(Number(type), url, appId, beginTime, endTime);
    return func.result({ data: result });
  }

  @Get("/getEnvironmentForPage")
  @ApiOperation({ summary: "Get environment info for a page" })
  @ApiResponse({ type: WebMonitorEnvironmentResponseDto })
  async getEnvironmentForPage(@Query() q: any) {
    const { appId, markPage } = q;
    if (!appId) throw new Error("Get user system info by markPage: appId must not be empty");
    if (!markPage) throw new Error("Get user system info by markPage: markPage must not be empty");
    const result = await this.envSrv.getEnvironmentForPage(appId, markPage);
    return func.result({ data: result });
  }
}
