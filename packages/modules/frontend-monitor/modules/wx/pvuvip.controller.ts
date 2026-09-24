import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {ConfigService} from '@nestjs/config';
import {func} from '../../shared/utils';
import {WxPvuvipService} from './services/pvuvip.service';
import {FrontendMonitorPvUvIpResponseDto} from '../web/pvuvip.dto';
import {DayReportNumService} from '../../modules/day-report/day-report-num.service';
import parser from 'cron-parser';

@ApiTags('Frontend Monitor / Wx / PvUvIp')
@Controller('/api/v1/wx/pvuvip')
export class WxPvuvipController {
  private cfg: any;
  constructor(
    private readonly configService: ConfigService,
    private readonly wxPvuvip: WxPvuvipService,
    private readonly dayReportNum: DayReportNumService
  ) {
    this.cfg = this.configService.get('microservices.frontend-monitor');
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
    const result: any = await this.wxPvuvip.getPvUvIpSurvey(
      appId,
      func.format(new Date(), 'yyyy/MM/dd') + ' 00:00:00',
      new Date()
    );
    const today = new Date(func.format(new Date(), 'yyyy/MM/dd')).getTime();
    const num = await this.dayReportNum.getTodayFromRedis(appId, today);
    if (num) result.num = num;
    return func.result({time: betweenTime, data: result || {}});
  }

  @Get('/getPvUvIpSurveyOne')
  @ApiOperation({summary: 'Get PV/UV/IP survey for a time range'})
  @ApiResponse({type: Object})
  async getPvUvIpSurveyOne(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('pvuvip概况统计：appId不能为空');
    if (!beginTime) throw new Error('pvuvip概况统计：beginTime不能为空');
    if (!endTime) throw new Error('pvuvip概况统计：endTime不能为空');
    const result = await this.wxPvuvip.getPvUvIpSurveyOne(appId, beginTime, endTime);
    return func.result({data: result});
  }

  @Get('/getHistoryPvUvIplist')
  @ApiOperation({summary: 'Get history PV/UV/IP list'})
  @ApiResponse({type: FrontendMonitorPvUvIpResponseDto, isArray: true})
  async getHistoryPvUvIplist(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('pvuvip获得历史概况：appId不能为空');
    const result = await this.wxPvuvip.getHistoryPvUvIplist(appId);
    return func.result({data: result});
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
    const b = beginTime || new Date(timestrat - betweenTime * 30);
    const e = endTime || new Date(timestrat);
    const dataList = (await this.wxPvuvip.getPvUvIpData(appId, b, e)) || [];
    const result = await this.wxPvuvip.getTimeList(b, e, dataList, betweenTime);
    return func.result({time: betweenTime, data: result});
  }

  @Get('/getPvUvIpOne')
  @ApiOperation({summary: 'Get single PV/UV/IP survey'})
  @ApiResponse({type: Object})
  async getPvUvIpOne(@Query() q: any) {
    const {appId, endTime, beginTime} = q;
    if (!appId) throw new Error('界面查询pvuvip：appId不能为空');
    const interval = parser.parseExpression(this.cfg.pvuvip_task_minute_cron_time);
    interval.prev();
    const e = endTime || new Date(interval.prev().toString());
    const b = beginTime || new Date(interval.prev().toString());
    const dataList = (await this.wxPvuvip.getPvUvIpData(appId, b, e)) || [];
    let result: any = {};
    if (dataList.length) {
      result = {
        time: dataList[0].createTime,
        pv: dataList[0].pv || 0,
        uv: dataList[0].uv || 0,
        ip: dataList[0].ip || 0,
        ajax: dataList[0].ajax || 0,
        flow: Math.floor((dataList[0].flow || 0) / 1024 / 1024),
      };
    } else {
      result = {
        time: func.format(e, 'yyyy/MM/dd hh:mm') + ':00',
        pv: 0,
        uv: 0,
        ip: 0,
        ajax: 0,
        flow: 0,
      };
    }
    return func.result({data: result});
  }
}
