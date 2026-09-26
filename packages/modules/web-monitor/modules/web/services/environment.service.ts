import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';

@Injectable()
export class EnvironmentService {
  constructor(private readonly models: MonitorModelsService) {}

  async getDataGroupBy(type: number, url: string, appId: string, beginTime?: string, endTime?: string) {
    const match: any = {url};
    if (beginTime && endTime) match.createTime = {$gte: new Date(beginTime), $lte: new Date(endTime)};
    const group_id = {
      url: '$url',
      city: `${type === 1 ? '$city' : ''}`,
      browser: `${type === 2 ? '$browser' : ''}`,
      system: `${type === 3 ? '$system' : ''}`,
    };
    const datas = await this.models
      .WebEnvironment(appId)
      .aggregate([{$match: match}, {$group: {_id: group_id, count: {$sum: 1}}}, {$sort: {count: -1}}, {$limit: 10}])
      .read('secondaryPreferred')
      .exec();
    return datas;
  }

  async getEnvironmentForPage(appId: string, markPage: string) {
    return await this.models.WebEnvironment(appId).findOne({markPage}).read('secondaryPreferred').exec();
  }
}
