import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {SystemService} from '../../../modules/system/system.service';
import {PvuvipService} from './pvuvip.service';
import {func} from '../../../shared/utils';

function cronMinuteInterval(cronExp: string) {
  const m = cronExp.split(' ')[1] || '*/2';
  const match = m.match(/\*\/(\d+)/);
  const step = match ? Number(match[1]) : 2;
  return step * 60000;
}

@Injectable()
export class WebPvuvipTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly system: SystemService,
    private readonly pvuvip: PvuvipService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }

  async getWebPvUvIpByMinute() {
    const between = cronMinuteInterval(this.cfg.pvuvip_task_minute_cron_time);
    const endTime = new Date();
    const beginTime = new Date(endTime.getTime() - between);

    const systems = await this.system.getWebSystemList();
    if (!systems || !systems.length) return;

    const jobs = systems.map(async (sys: any) => {
      const appId = sys.appId;
      if (!appId || sys.isUse !== 0) return;
      const data = await this.pvuvip.getPvUvIpSurvey(appId, beginTime, endTime);
      await this.pvuvip.savePvUvIpData(appId, endTime, 1, data);
    });
    await Promise.all(jobs);
  }

  async getWebPvUvIpByDay() {
    const todayStart = new Date(func.format(new Date(), 'yyyy/MM/dd 00:00:00'));
    const endTime = todayStart;
    const beginTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
    const systems = await this.system.getWebSystemList();
    if (!systems || !systems.length) return;
    await this.groupData(systems, 2, beginTime, endTime, beginTime);
  }

  private async groupData(datas: any[], type: number, beginTime: Date, endTime: Date, createTime: Date) {
    for (const sys of datas) {
      const appId = sys.appId;
      if (!appId || sys.isUse !== 0) continue;
      await this.savePvUvIpData(appId, createTime, type, beginTime, endTime);
    }
  }

  private async savePvUvIpData(appId: string, createTime: Date, type: number, beginTime: Date, endTime: Date) {
    const pvuvipdata = await this.pvuvip.getPvUvIpSurvey(appId, beginTime, endTime, type === 2);
    await this.pvuvip.savePvUvIpData(appId, createTime, type, pvuvipdata);
  }
}
