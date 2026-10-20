import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { PageService } from "./services/page.service";
import {
  ListWebMonitorPageAveragesResponseDto,
  WebMonitorPageDetailResponseDto,
  ListWebMonitorPageVisitsResponseDto,
  WebMonitorRealTimePageItemResponseDto,
} from "./page.dto";

@ApiTags("Frontend Monitor / Web / Pages")
@Controller("/web-monitor/pages")
export class PageController {
  constructor(private readonly pageSrv: PageService) {}

  @Get("/getAveragePageList")
  @ApiOperation({ summary: "Get average page performance list" })
  @ApiResponse({ type: ListWebMonitorPageAveragesResponseDto })
  async getAveragePageList(@Query() q: Record<string, unknown>) {
    const { appId } = q;
    if (!appId) throw new Error("Average page performance list: appId must not be empty");
    const result = await this.pageSrv.getAveragePageList(q);
    return func.result({ data: result });
  }

  @Get("/getRealTimeAveragePageList")
  @ApiOperation({ summary: "Get real-time average page performance list" })
  @ApiResponse({ type: WebMonitorRealTimePageItemResponseDto, isArray: true })
  async getRealTimeAveragePageList(@Query() q: Record<string, unknown>) {
    const { appId } = q;
    if (!appId) throw new Error("Realtime average page performance list: appId must not be empty");
    if (!q.beginTime || !q.endTime)
      throw new Error("Realtime average page performance list: beginTime or endTime must not be empty");
    if (func.toDate(q.endTime).getTime() - func.toDate(q.beginTime).getTime() > 60000 * 60) {
      throw new Error(
        "Realtime average page performance list: the interval between beginTime and endTime must not exceed one hour",
      );
    }
    const data = await this.pageSrv.getRealTimeAveragePageList(q);
    return func.result({ data });
  }

  @Get("/getOnePageList")
  @ApiOperation({ summary: "Get single page performance or visit list" })
  @ApiResponse({ type: ListWebMonitorPageVisitsResponseDto })
  async getOnePageList(@Query() q: Record<string, unknown>) {
    const { appId, url } = q;
    if (!appId) throw new Error("Single page performance or visit list: appId must not be empty");
    if (!url) throw new Error("Single page performance or visit list: url must not be empty");
    const result = await this.pageSrv.getOnePageList(q);
    return func.result({ data: result });
  }

  @Get("/getPageDetails")
  @ApiOperation({ summary: "Get single page details" })
  @ApiResponse({ type: WebMonitorPageDetailResponseDto })
  async getPageDetails(@Query() q: Record<string, unknown>) {
    const { appId, id } = q;
    if (!id) throw new Error("Single page details: id must not be empty");
    if (!appId) throw new Error("Single page details: appId must not be empty");
    const row = await this.pageSrv.getPageDetails(String(appId), String(id));
    return func.result({ data: row || {} });
  }
}
