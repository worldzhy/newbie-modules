import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DayReportNumService } from "@modules/frontend-monitor/modules/day-report/day-report-num.service";
import { func, pickRequestId } from "../../shared/utils";
import { FRONTEND_MONITOR_CONFIG } from "../../shared/frontend-monitor-config";
import { PvuvipService } from "./services/pvuvip.service";
import { FrontendMonitorPvUvIpResponseDto } from "./pvuvip.dto";
import parser from "cron-parser";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";
import { VISIBLE_APP_KEYS_RESOLVER, VisibleAppKeysResolver } from "../../shared/visible-app-keys.port";

@ApiTags("Frontend Monitor / Web / PvUvIp")
@Controller("/frontend-monitor/pvuvip")
export class PvuvipController {
  constructor(
    private readonly pvuvipSrv: PvuvipService,
    private readonly dayReportNum: DayReportNumService,
    private readonly access: FrontendMonitorAccessService,
    @Inject(VISIBLE_APP_KEYS_RESOLVER)
    private readonly projectVisibility: VisibleAppKeysResolver,
  ) {}

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getPvUvIpSurveyToday")
  @ApiOperation({ summary: "Get today's PV/UV/IP survey" })
  @ApiResponse({ type: Object })
  async getPvUvIpSurveyToday(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const interval = parser.parseExpression(String(FRONTEND_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
    const timer = interval.prev().toString();
    const timestrat = new Date(interval.prev().toString()).getTime();
    const betweenTime = Math.abs(new Date(timer).getTime() - timestrat);
    const todayStart = new Date(func.format(new Date(), "yyyy/MM/dd 00:00:00"));
    const survey = await this.pvuvipSrv.getPvUvIpSurvey(appKey, todayStart, new Date());
    const num = await this.dayReportNum.getTodayFromRedis(
      appKey,
      new Date(func.format(new Date(), "yyyy/MM/dd")).getTime(),
    );
    return func.result({ time: betweenTime, data: { ...survey, num } });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getPvUvIpSurveyOne")
  @ApiOperation({ summary: "Get PV/UV/IP survey for a time range" })
  @ApiResponse({ type: FrontendMonitorPvUvIpResponseDto })
  async getPvUvIpSurveyOne(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    if (!beginTime) throw new BadRequestException("beginTime is required");
    if (!endTime) throw new BadRequestException("endTime is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const result = await this.pvuvipSrv.getPvUvIpSurveyOne(appKey, func.toDate(beginTime), func.toDate(endTime));
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getHistoryPvUvIplist")
  @ApiOperation({ summary: "Get history PV/UV/IP list" })
  @ApiResponse({ type: FrontendMonitorPvUvIpResponseDto, isArray: true })
  async getHistoryPvUvIplist(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    if (!beginTime) throw new BadRequestException("beginTime is required");
    if (!endTime) throw new BadRequestException("endTime is required");
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const rows = await this.pvuvipSrv.getHistoryPvUvIplistByRange(
      appKey,
      new Date(Number(beginTime)),
      new Date(Number(endTime)),
    );
    return func.result({ data: rows || [] });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getPvUvIpList")
  @ApiOperation({ summary: "Get PV/UV/IP data list" })
  @ApiResponse({ type: Object })
  async getPvUvIpList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const interval = parser.parseExpression(String(FRONTEND_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
    const timer = interval.prev().toString();
    const timestrat = new Date(interval.prev().toString()).getTime();
    const betweenTime = Math.abs(new Date(timer).getTime() - timestrat);
    const bt = beginTime ? func.toDate(beginTime) : new Date(timestrat - betweenTime * 30);
    const et = endTime ? func.toDate(endTime) : new Date(timestrat);
    const data = await this.pvuvipSrv.getPvUvIpData(appKey, bt, et);
    return func.result({ time: betweenTime, data });
  }

  @RequirePermission(PermissionAction.Get, "FrontendMonitorSite")
  @Get("/getPvUvIpOne")
  @ApiOperation({ summary: "Get single PV/UV/IP survey" })
  @ApiResponse({ type: Object })
  async getPvUvIpOne(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { beginTime, endTime } = q;
    const appKeys = await this.projectVisibility.visibleAppKeys(req.user.userId);
    const appKey = this.access.assertVisibleAppKey(appKeys, pickRequestId(req, "appKey"));
    const interval = parser.parseExpression(String(FRONTEND_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
    interval.prev();
    let et: Date;
    let bt: Date;
    if (beginTime || endTime) {
      bt = beginTime ? func.toDate(beginTime) : new Date();
      et = endTime ? func.toDate(endTime) : new Date();
    } else {
      et = new Date(interval.prev().toString());
      bt = new Date(interval.prev().toString());
    }
    const res = await this.pvuvipSrv.getPvUvIpSurveyOne(appKey, bt, et);
    const timeStr = func.format(et, "yyyy/MM/dd hh:mm") + ":00";
    return func.result({ data: { time: timeStr, ...res } });
  }
}
