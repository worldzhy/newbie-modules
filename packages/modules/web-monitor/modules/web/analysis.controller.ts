import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { WebMonitorAnalysisService } from "./services/analysis.service";
import {
  ListWebMonitorAnalysisUsersResponseDto,
  WebMonitorProvinceCountResponseDto,
  WebMonitorWebTopDatasResponseDto,
} from "./analysis.dto";
import { WebMonitorEnvironmentResponseDto } from "./environment.dto";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";

@ApiTags("Frontend Monitor / Web / Analysis")
@RequireOwner()
@Controller("/web-monitor/analysis")
export class WebMonitorAnalysisController {
  constructor(private readonly analysisService: WebMonitorAnalysisService) {}

  @Get("/getAnalysislist")
  @ApiOperation({ summary: "Get user funnel analysis list" })
  @ApiResponse({ type: ListWebMonitorAnalysisUsersResponseDto })
  async getAnalysislist(@Query() q: Record<string, unknown>) {
    const { appId, beginTime, endTime, uid, phone } = q;
    if (!appId) throw new Error("User funnel analysis list: appId must not be empty");
    const result = await this.analysisService.getAnalysislist(
      String(appId),
      beginTime as string | undefined,
      endTime as string | undefined,
      { uid: uid as string | undefined, phone: phone as string | undefined },
    );
    return func.result({ data: result });
  }

  @Get("/getAnalysisOneList")
  @ApiOperation({ summary: "Get single user behavior track list" })
  @ApiResponse({ type: WebMonitorEnvironmentResponseDto, isArray: true })
  async getAnalysisOneList(@Query() q: Record<string, unknown>) {
    const { appId, markUser } = q;
    if (!appId) throw new Error("Single user behavior trail list: appId must not be empty");
    if (!markUser) throw new Error("Single user behavior trail list: markUser must not be empty");
    const result = await this.analysisService.getAnalysisOneList(String(appId), String(markUser));
    return func.result({ data: result });
  }

  @Get("/getTopDatas")
  @ApiOperation({ summary: "Get top data statistics" })
  @ApiResponse({ type: WebMonitorWebTopDatasResponseDto })
  async getTopDatas(@Query() q: Record<string, unknown>) {
    const { appId, beginTime, endTime } = q;
    if (!appId) throw new Error("appId must not be empty");
    const data = await this.analysisService.getTopDatas(
      String(appId),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data });
  }

  @Get("/getProvinceCount")
  @ApiOperation({ summary: "Get province count statistics" })
  @ApiResponse({ type: WebMonitorProvinceCountResponseDto })
  async getProvinceCount(@Query() q: Record<string, unknown>) {
    const { appId, beginTime, endTime } = q;
    if (!appId) throw new Error("appId must not be empty");
    const result = await this.analysisService.getProvinceCount(
      String(appId),
      beginTime as string | undefined,
      endTime as string | undefined,
    );
    return func.result({ data: result });
  }
}
