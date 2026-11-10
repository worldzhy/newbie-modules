import { Injectable } from "@nestjs/common";
import { FrontendMonitorModelsService } from "../../../models/mongo/frontend-monitor-models.service";

@Injectable()
export class EnvironmentService {
  constructor(private readonly models: FrontendMonitorModelsService) {}

  async getDataGroupBy(type: number, url: string, appKey: string, beginTime?: string, endTime?: string) {
    const match: Record<string, unknown> = { url };
    const createTime: Record<string, unknown> = {};
    if (beginTime) createTime.$gte = new Date(beginTime);
    if (endTime) createTime.$lte = new Date(endTime);
    if (Object.keys(createTime).length) match.createTime = createTime;
    const group_id = {
      url: "$url",
      city: `${type === 1 ? "$city" : ""}`,
      browser: `${type === 2 ? "$browser" : ""}`,
      system: `${type === 3 ? "$system" : ""}`,
    };
    const datas = await this.models
      .WebEnvironment(appKey)
      .aggregate([
        { $match: match },
        { $group: { _id: group_id, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .read("secondaryPreferred")
      .exec();
    return datas;
  }

  async getEnvironmentForPage(appKey: string, markPage: string) {
    return await this.models.WebEnvironment(appKey).findOne({ markPage }).read("secondaryPreferred").exec();
  }
}
