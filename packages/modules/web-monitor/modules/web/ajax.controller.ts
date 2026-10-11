import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { AjaxService } from "./services/ajax.service";
import {
  WebMonitorAjaxAverageListResponseDto,
  WebMonitorAjaxMarkUserListResponseDto,
  WebMonitorAjaxOneListResponseDto,
} from "./ajax.dto";

@ApiTags("Frontend Monitor / Web / Ajax")
@Controller("/api/v1/ajax")
export class AjaxController {
  constructor(private readonly ajax: AjaxService) {}

  @Get("/getPageAjaxsAvg")
  @ApiOperation({ summary: "Get page ajax average performance" })
  @ApiResponse({ type: WebMonitorAjaxAverageListResponseDto })
  async getPageAjaxsAvg(@Query() q: Record<string, unknown>) {
    const { appId, url, beginTime, endTime } = q;
    if (!appId) throw new Error("Page ajax info: appId must not be empty");
    if (!url) throw new Error("Page ajax info: url must not be empty");
    const result = await this.ajax.getPageAjaxsAvg(
      String(appId),
      String(url),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }

  @Get("/getAverageAjaxList")
  @ApiOperation({ summary: "Get average ajax performance list" })
  @ApiResponse({ type: WebMonitorAjaxAverageListResponseDto })
  async getAverageAjaxList(@Query() q: Record<string, unknown>) {
    const { appId } = q;
    if (!appId) throw new Error("Average AJAX performance list: appId must not be empty");
    const result = await this.ajax.getAverageAjaxList(q);
    return func.result({ data: result });
  }

  @Get("/getOneAjaxList")
  @ApiOperation({ summary: "Get single ajax average performance data" })
  @ApiResponse({ type: WebMonitorAjaxOneListResponseDto })
  async getOneAjaxList(@Query() q: Record<string, unknown>) {
    const { appId, url, pageNo = 1, pageSize = 15, beginTime, endTime, type } = q;
    if (!appId) throw new Error("Single AJAX average performance data: appId must not be empty");
    if (!url) throw new Error("Single AJAX average performance data: api url must not be empty");
    const result = await this.ajax.getOneAjaxList(
      String(appId),
      String(url),
      Number(pageNo),
      Number(pageSize),
      beginTime as string | undefined,
      endTime as string | undefined,
      Number(type),
    );
    return func.result({ data: result });
  }

  @Get("/getMarkUserAjaxList")
  @ApiOperation({ summary: "Get marked user ajax list" })
  @ApiResponse({ type: WebMonitorAjaxMarkUserListResponseDto })
  async getMarkUserAjaxList(@Query() q: Record<string, unknown>) {
    const { appId, markUser, beginTime, endTime } = q;
    if (!markUser) throw new Error("markUser must not be empty");
    if (!appId) throw new Error("Get single ajax details: appId must not be empty");
    const result = await this.ajax.getMarkUserAjaxList(String(appId), {
      markUser: String(markUser),
      beginTime: beginTime as string | undefined,
      endTime: endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
