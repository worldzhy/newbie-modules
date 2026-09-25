import {Controller, Post, Headers, Body} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {SystemService} from '../../modules/system/system.service';
import {ConfigService} from '@nestjs/config';
import {RedisService} from '../../models/redis/redis.service';
import {DayReportNumService} from '../../modules/day-report/day-report-num.service';
import {func, getRandomIp} from '../../shared/utils';
import {RedisKeys} from '../../models/enum';

@ApiTags('Frontend Monitor / Wx / Report')
@Controller('/api/v1/wx')
export class WxReportController {
  private config: any;
  constructor(
    private readonly system: SystemService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly dayReportNum: DayReportNumService
  ) {
    this.config = this.configService.get('modules.frontend-monitor');
  }

  @Post('/report/wx')
  @ApiOperation({summary: 'Wx SDK data report endpoint'})
  @ApiResponse({type: String})
  async wxReport(@Headers() headers: Record<string, string | undefined>, @Body() body: any) {
    let query: any = body;
    if (headers['content-type'] && headers['content-type'].includes('text/plain')) {
      query = JSON.parse(body as string);
    }
    if (!query.appId) throw new Error('wx端上报数据操作：appId不能为空');

    query.ip = func.getRealIp(headers as any);
    const system = await this.system.getSystemForAppId(query.appId);
    if (!system?.appId) throw new Error(`appId:${query.appId} 不存在`);

    if (this.config.isLocalDev) query.ip = getRandomIp();

    const limit = this.config.redis_consumption?.total_limit_wx;
    if (limit) {
      const length = await this.redis.llen(RedisKeys.WX_REPORT_DATAS);
      if (length >= limit) throw new Error(`reids: ${RedisKeys.WX_REPORT_DATAS}:达到限流（${limit}）`);
    }
    await this.redis.lpush(RedisKeys.WX_REPORT_DATAS, JSON.stringify(query));
    await this.dayReportNum.redisCount(query.appId);
    return func.result({data: 'ok'});
  }
}
