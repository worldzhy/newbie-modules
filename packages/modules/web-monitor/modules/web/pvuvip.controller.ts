import { BadRequestException, Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { DayReportNumService } from "@modules/web-monitor/modules/day-report/day-report-num.service";
import { func } from "../../shared/utils";
import { WEB_MONITOR_CONFIG } from "../../shared/web-monitor-config";
import { PvuvipService } from "./services/pvuvip.service";
import { WebMonitorPvUvIpResponseDto } from "./pvuvip.dto";
import parser from "cron-parser";
import { PermissionAction } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { WebMonitorAccessService } from "./web-monitor-access.service";
import { PROJECT_VISIBLE_IDS_RESOLVER, ProjectVisibleIdsResolver } from "../../shared/project-visible-ids.port";

@ApiTags("Frontend Monitor / Web / PvUvIp")
@Controller("/web-monitor/pvuvip")
export class PvuvipController {
  private cfg: Record<string, unknown>;
  constructor(
    private readonly configService: ConfigService,
    private readonly pvuvipSrv: PvuvipService,
    private readonly dayReportNum: DayReportNumService,
    private readonly access: WebMonitorAccessService,
    @Inject(PROJECT_VISIBLE_IDS_RESOLVER)
    private readonly projectVisibility: ProjectVisibleIdsResolver,
  ) {
    this.cfg = this.configService.get("modules.web-monitor") || {};
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPvUvIpSurveyToday")
  @ApiOperation({ summary: "Get today's PV/UV/IP survey" })
  @ApiResponse({ type: Object })
  async getPvUvIpSurveyToday(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const interval = parser.parseExpression(String(WEB_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
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

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPvUvIpSurveyOne")
  @ApiOperation({ summary: "Get PV/UV/IP survey for a time range" })
  @ApiResponse({ type: WebMonitorPvUvIpResponseDto })
  async getPvUvIpSurveyOne(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!beginTime) throw new BadRequestException("beginTime is required");
    if (!endTime) throw new BadRequestException("endTime is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const result = await this.pvuvipSrv.getPvUvIpSurveyOne(appKey, func.toDate(beginTime), func.toDate(endTime));
    return func.result({ data: result });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getHistoryPvUvIplist")
  @ApiOperation({ summary: "Get history PV/UV/IP list" })
  @ApiResponse({ type: WebMonitorPvUvIpResponseDto, isArray: true })
  async getHistoryPvUvIplist(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    if (!beginTime) throw new BadRequestException("beginTime is required");
    if (!endTime) throw new BadRequestException("endTime is required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const rows = await this.pvuvipSrv.getHistoryPvUvIplistByRange(
      appKey,
      new Date(Number(beginTime)),
      new Date(Number(endTime)),
    );
    return func.result({ data: rows || [] });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPvUvIpList")
  @ApiOperation({ summary: "Get PV/UV/IP data list" })
  @ApiResponse({ type: Object })
  async getPvUvIpList(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const interval = parser.parseExpression(String(WEB_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
    const timer = interval.prev().toString();
    const timestrat = new Date(interval.prev().toString()).getTime();
    const betweenTime = Math.abs(new Date(timer).getTime() - timestrat);
    const bt = beginTime ? func.toDate(beginTime) : new Date(timestrat - betweenTime * 30);
    const et = endTime ? func.toDate(endTime) : new Date(timestrat);
    const data = await this.pvuvipSrv.getPvUvIpData(appKey, bt, et);
    return func.result({ time: betweenTime, data });
  }

  @RequirePermission(PermissionAction.Get, "WebMonitorSite")
  @Get("/getPvUvIpOne")
  @ApiOperation({ summary: "Get single PV/UV/IP survey" })
  @ApiResponse({ type: Object })
  async getPvUvIpOne(@Query() q: Record<string, unknown>, @Req() req: UserRequest) {
    const { projectId, applicationId, beginTime, endTime } = q;
    if (!projectId || !applicationId) throw new BadRequestException("projectId and applicationId are required");
    const projectIds = await this.projectVisibility.visibleProjectIds(req.user.userId);
    const appKey = await this.access.resolveAppKey(projectIds, String(projectId), String(applicationId));
    const interval = parser.parseExpression(String(WEB_MONITOR_CONFIG.pvuvip_task_minute_cron_time));
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
