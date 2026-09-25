import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../models/mongo/monitor-models.service';
import {RedisService} from '../../models/redis/redis.service';
import {ConfigService} from '@nestjs/config';
import moment from 'moment';
import {func} from '../../shared/utils';
import {RedisKeyPrefix} from '../../models/enum';

@Injectable()
export class DayReportNumService {
  private cfg: any;
  constructor(
    private readonly models: MonitorModelsService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService
  ) {
    this.cfg = this.configService.get('modules.frontend-monitor');
  }

  async numCountTask() {
    const date = new Date(new Date().getTime() - 86400000);
    const yesterday = new Date(func.format(date, 'yyyy/MM/dd')).getTime();
    const apps = await this.models.System().find().read('secondaryPreferred').exec();

    for (const app of apps) {
      const key = `${RedisKeyPrefix.DAY_REPORT_NUM}${app.appId}_${yesterday}`;
      const num = await this.redis.get(key);
      if (!num) continue;

      const DayModel = this.models.DayReportNum();
      const repore = new DayModel();
      repore.appId = app.appId;
      repore.type = app.type;
      repore.dayTime = new Date(yesterday);
      repore.createTime = new Date();
      repore.num = Number(num);
      await repore.save();

      await this.redis.del(key);
    }
  }

  async getTodayFromRedis(appId: string, today: number) {
    return await this.redis.get(`${RedisKeyPrefix.DAY_REPORT_NUM}${appId}_${today}`);
  }

  async getDayFromMongo(appId: string, beginTime: string | Date, endTime: string | Date) {
    const query = {
      appId,
      dayTime: {
        $gte: new Date(moment(beginTime).format('YYYY-MM-DD 00:00:00')),
        $lte: new Date(moment(endTime).format('YYYY-MM-DD 23:59:59')),
      },
    };
    return (
      (await this.models.DayReportNum().findOne(query, {num: 1, dayTime: 1}).read('secondaryPreferred').exec()) ||
      ({} as any)
    );
  }

  async redisCount(appId: string) {
    const date = new Date();
    const today = new Date(func.format(date, 'yyyy/MM/dd')).getTime();
    await this.redis.incr(`${RedisKeyPrefix.DAY_REPORT_NUM}${appId}_${today}`);
  }
}
