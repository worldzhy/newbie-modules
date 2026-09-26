import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {ConfigService} from '@nestjs/config';
import {DayReportNumService} from '../../modules/day-report/day-report-num.service';
import {func} from '../../shared/utils';
import {PvuvipService} from './services/pvuvip.service';
import {WebMonitorPvUvIpResponseDto} from './pvuvip.dto';
import parser from 'cron-parser';

@ApiTags('Frontend Monitor / Web / PvUvIp')
@Controller('/api/v1/pvuvip')
export class PvuvipController {
  private cfg: any;
  constructor(
    private readonly configService: ConfigService,
    private readonly pvuvipSrv: PvuvipService,
    private readonly dayReportNum: DayReportNumService
  ) {
    this.cfg = this.configService.get('modules.web-monitor');
  }

  @Get('/getPvUvIpSurveyToday')
  @ApiOperation({summary: "Get today's PV/UV/IP survey"})
  @ApiResponse({type: Object})
  async getPvUvIpSurveyToday(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('pvuvip概况统计：appId不能为空');
    const interval = parser.parseExpression(this.cfg.pvuvip_task_minute_cron_time);
    const timer = interval.prev().toString();
    const timestrat = new Date(interval.prev().toString()).getTime();
    const betweenTime = Math.abs(new Date(timer).getTime() - timestrat);
    const todayStart = new Date(func.format(new Date(), 'yyyy/MM/dd 00:00:00'));
    const survey = await this.pvuvipSrv.getPvUvIpSurvey(appId, todayStart, new Date());
    const num = await this.dayReportNum.getTodayFromRedis(
      appId,
      new Date(func.format(new Date(), 'yyyy/MM/dd')).getTime()
    );
    return func.result({time: betweenTime, data: {...survey, num}});
  }

  @Get('/getPvUvIpSurveyOne')
  @ApiOperation({summary: 'Get PV/UV/IP survey for a time range'})
  @ApiResponse({type: WebMonitorPvUvIpResponseDto})
  async getPvUvIpSurveyOne(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('pvuvip概况统计：appId不能为空');
    if (!beginTime) throw new Error('pvuvip概况统计：beginTime不能为空');
    if (!endTime) throw new Error('pvuvip概况统计：endTime不能为空');
    const result = await this.pvuvipSrv.getPvUvIpSurveyOne(appId, new Date(beginTime), new Date(endTime));
    return func.result({data: result});
  }

  @Get('/getHistoryPvUvIplist')
  @ApiOperation({summary: 'Get history PV/UV/IP list'})
  @ApiResponse({type: WebMonitorPvUvIpResponseDto, isArray: true})
  async getHistoryPvUvIplist(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('pvuvip获得历史概况：appId不能为空');
    if (!beginTime) throw new Error('pvuvip获得历史概况：beginTime不能为空');
    if (!endTime) throw new Error('pvuvip获得历史概况：endTime不能为空');
    const rows = await this.pvuvipSrv.getHistoryPvUvIplistByRange(
      appId,
      new Date(Number(beginTime)),
      new Date(Number(endTime))
    );
    return func.result({data: rows || []});
  }

  @Get('/getPvUvIpList')
  @ApiOperation({summary: 'Get PV/UV/IP data list'})
  @ApiResponse({type: Object})
  async getPvUvIpList(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('界面查询pvuvip：appId不能为空');
    const interval = parser.parseExpression(this.cfg.pvuvip_task_minute_cron_time);
    const timer = interval.prev().toString();
    const timestrat = new Date(interval.prev().toString()).getTime();
    const betweenTime = Math.abs(new Date(timer).getTime() - timestrat);
    const bt = beginTime ? new Date(beginTime) : new Date(timestrat - betweenTime * 30);
    const et = endTime ? new Date(endTime) : new Date(timestrat);
    const data = await this.pvuvipSrv.getPvUvIpData(appId, bt, et);
    return func.result({time: betweenTime, data});
  }

  @Get('/getPvUvIpOne')
  @ApiOperation({summary: 'Get single PV/UV/IP survey'})
  @ApiResponse({type: Object})
  async getPvUvIpOne(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('界面查询pvuvip：appId不能为空');
    const interval = parser.parseExpression(this.cfg.pvuvip_task_minute_cron_time);
    interval.prev();
    let et: Date;
    let bt: Date;
    if (beginTime || endTime) {
      bt = beginTime ? new Date(beginTime) : new Date();
      et = endTime ? new Date(endTime) : new Date();
    } else {
      et = new Date(interval.prev().toString());
      bt = new Date(interval.prev().toString());
    }
    const res = await this.pvuvipSrv.getPvUvIpSurveyOne(appId, bt, et);
    const timeStr = func.format(et, 'yyyy/MM/dd hh:mm') + ':00';
    return func.result({data: {time: timeStr, ...res}});
  }
}
