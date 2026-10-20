import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { func } from "../../shared/utils";
import { ErrorService } from "./services/error.service";
import {
  ListWebMonitorErrorsResponseDto,
  ListWebMonitorErrorMarkUsersResponseDto,
  ListWebMonitorErrorOnesResponseDto,
} from "./error.dto";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";

@ApiTags("Frontend Monitor / Web / Error")
@RequireOwner()
@Controller("/web-monitor/error")
export class ErrorController {
  constructor(private readonly errorSrv: ErrorService) {}

  @Get("/getAverageErrorList")
  @ApiOperation({ summary: "Get average error category list" })
  @ApiResponse({ type: ListWebMonitorErrorsResponseDto })
  async getAverageErrorList(@Query() q: Record<string, unknown>) {
    const { appId } = q;
    if (!appId) throw new Error("Get error category list: appId must not be empty");
    const result = await this.errorSrv.getAverageErrorList(q);
    return func.result({ data: result });
  }

  @Get("/getOneErrorList")
  @ApiOperation({ summary: "Get single error resource list" })
  @ApiResponse({ type: ListWebMonitorErrorOnesResponseDto })
  async getOneErrorList(@Query() q: Record<string, unknown>) {
    const { appId, url } = q;
    if (!appId) throw new Error("Get single ERROR resource list: appId must not be empty");
    if (!url) throw new Error("Get single ERROR resource list: url must not be empty");
    const result = await this.errorSrv.getOneErrorList(q);
    return func.result({ data: result });
  }

  @Get("/getMarkUserErrorList")
  @ApiOperation({ summary: "Get marked user error list" })
  @ApiResponse({ type: ListWebMonitorErrorMarkUsersResponseDto })
  async getMarkUserErrorList(@Query() q: Record<string, unknown>) {
    const { appId, markUser, beginTime, endTime } = q;
    if (!markUser) throw new Error("markUser must not be empty");
    if (!appId) throw new Error("Get single ajax details: appId must not be empty");
    const result = await this.errorSrv.getMarkUserErrorListCH(String(appId), {
      markUser: String(markUser),
      beginTime: beginTime as string | undefined,
      endTime: endTime as string | undefined,
    });
    return func.result({ data: result });
  }
}
