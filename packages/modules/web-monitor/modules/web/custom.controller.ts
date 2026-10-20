import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { WebCustomService } from "./services/custom.service";
import { ListWebMonitorCustomAveragesResponseDto, ListWebMonitorCustomFiltersResponseDto } from "./custom.dto";

@ApiTags("Frontend Monitor / Web / Custom")
@Controller("/web-monitor/custom")
export class CustomController {
  constructor(private readonly webCustom: WebCustomService) {}

  @Get("/getCustomFilterList")
  @ApiOperation({ summary: "Get custom filter list" })
  @ApiResponse({ type: ListWebMonitorCustomFiltersResponseDto })
  async getCustomFilterList(@Query() q: Record<string, unknown>) {
    const { appId } = q;
    if (!appId) throw new Error("Get custom filters: appId must not be empty");
    const result = await this.webCustom.getCustomFilterList(String(appId));
    return func.result({ data: result });
  }

  @Post("/addCustomFilter")
  @ApiOperation({ summary: "Add a custom filter" })
  @ApiResponse({ type: Boolean })
  async addCustomFilter(@Body() body: Record<string, unknown>) {
    const { appId, filterKey, filterDesc } = body;
    const ok = await this.webCustom.addCustomFilter(appId as string, filterKey as string, filterDesc as string);
    return func.result({ data: ok });
  }

  @Post("/delCustomFilter")
  @ApiOperation({ summary: "Delete a custom filter" })
  @ApiResponse({ type: Boolean })
  async delCustomFilter(@Body() body: Record<string, unknown>) {
    const { appId, _id } = body;
    const ok = await this.webCustom.delCustomFilter(appId as string, _id as string);
    return func.result({ data: ok });
  }

  @Get("/getAverageCustomList")
  @ApiOperation({ summary: "Get average custom category list" })
  @ApiResponse({ type: ListWebMonitorCustomAveragesResponseDto })
  async getAverageCustomList(@Query() q: Record<string, unknown>) {
    const { appId, pageNo = 1, pageSize = 15, beginTime, endTime, customName, customFilter } = q;
    if (!appId) throw new Error("Get custom category list: appId must not be empty");
    const result = await this.webCustom.getAverageCustomList(
      String(appId),
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
      customName as string | undefined,
      customFilter as Record<string, unknown> | undefined,
    );
    return func.result({ data: result });
  }
}
