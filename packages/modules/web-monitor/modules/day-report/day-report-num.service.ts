import { Injectable } from "@nestjs/common";
import { WebMonitorModelsService } from "../../models/mongo/web-monitor-models.service";
import { RedisService } from "@modules/redis/redis.service";
import dayjs from "dayjs";
import { func } from "../../shared/utils";
import { RedisKeyPrefix } from "../../models/enum";

@Injectable()
export class DayReportNumService {
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly redis: RedisService,
  ) {}

  async numCountTask() {
    const date = new Date(new Date().getTime() - 86400000);
    const yesterday = new Date(func.format(date, "yyyy/MM/dd")).getTime();
    const apps = await this.models.System().find().read("secondaryPreferred").exec();

    for (const app of apps) {
      const key = `${RedisKeyPrefix.DAY_REPORT_NUM}${app.appKey}_${yesterday}`;
      const num = await this.redis.getClient().get(key);
      if (!num) continue;

      const DayModel = this.models.DayReportNum();
      const repore = new DayModel();
      repore.appKey = app.appKey;
      repore.type = app.type;
      repore.dayTime = new Date(yesterday);
      repore.createTime = new Date();
      repore.num = Number(num);
      await repore.save();

      await this.redis.getClient().del(key);
    }
  }

  async getTodayFromRedis(appKey: string, today: number) {
    return await this.redis.getClient().get(`${RedisKeyPrefix.DAY_REPORT_NUM}${appKey}_${today}`);
  }

  async getDayFromMongo(appKey: string, beginTime: string | Date, endTime: string | Date) {
    const query = {
      appKey,
      dayTime: {
        $gte: new Date(dayjs(beginTime).format("YYYY-MM-DD 00:00:00")),
        $lte: new Date(dayjs(endTime).format("YYYY-MM-DD 23:59:59")),
      },
    };
    return await this.models.DayReportNum().findOne(query, { num: 1, dayTime: 1 }).read("secondaryPreferred").exec();
  }

  async redisCount(appKey: string) {
    const date = new Date();
    const today = new Date(func.format(date, "yyyy/MM/dd")).getTime();
    await this.redis.getClient().incr(`${RedisKeyPrefix.DAY_REPORT_NUM}${appKey}_${today}`);
  }
}
