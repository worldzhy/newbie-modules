import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SystemService} from '../../../modules/system/system.service';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {func} from '../../../shared/utils';

function cronMinuteInterval(cronExp: string) {
  const m = cronExp.split(' ')[1] || '*/2';
  const match = m.match(/\*\/(\d+)/);
  const step = match ? Number(match[1]) : 2;
  return step * 60000;
}

@Injectable()
export class WxPvuvipTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly system: SystemService,
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService
  ) {
    this.cfg = this.config.get('modules.frontend-monitor');
  }

  async getWxPvUvIpByMinute() {
    const between = cronMinuteInterval(this.cfg.pvuvip_task_minute_cron_time);
    const endTime = new Date();
    const beginTime = new Date(endTime.getTime() - between);
    const systems = await this.system.getWxSystemList();
    if (!systems || !systems.length) return;
    const jobs = systems.map(async (sys: any) => {
      const appId = sys.appId;
      if (!appId || sys.isUse !== 0) return;
      const pv = await this.models
        .WxPage(appId)
        .count({createTime: {$gte: beginTime, $lte: endTime}})
        .read('secondaryPreferred')
        .exec();
      const uvRows = await this.models
        .WxPage(appId)
        .aggregate([
          {$match: {createTime: {$gte: beginTime, $lte: endTime}}},
          {$group: {_id: {markUv: '$markUv'}, count: {$sum: 1}}},
        ])
        .read('secondaryPreferred')
        .exec();
      const ipRows = await this.models
        .WxPage(appId)
        .aggregate([
          {$match: {createTime: {$gte: beginTime, $lte: endTime}}},
          {$group: {_id: {ip: '$ip'}, count: {$sum: 1}}},
        ])
        .read('secondaryPreferred')
        .exec();
      const beginStr = func.format(beginTime, 'yyyy/MM/dd hh:mm:ss');
      const endStr = func.format(endTime, 'yyyy/MM/dd hh:mm:ss');
      const ajaxModel = await this.ch.WxAjax(appId);
      const ajaxRows = await ajaxModel.find({
        select: 'count() as count',
        where: `createTime>=toDateTime('${beginStr}') and createTime<=toDateTime('${endStr}')`,
      });
      const ajax = ajaxRows?.[0]?.count || 0;
      const pvuvipModel = this.models.WxPvuvip();
      const row = new pvuvipModel();
      row.appId = appId;
      row.pv = pv || 0;
      row.uv = uvRows?.length ? (uvRows[0].count ? uvRows.length : uvRows.length) : 0;
      row.ip = ipRows?.length ? (ipRows[0].count ? ipRows.length : ipRows.length) : 0;
      row.ajax = ajax || 0;
      row.flow = 0;
      row.type = 1;
      row.createTime = endTime;
      await row.save();
    });
    await Promise.all(jobs);
  }
}
