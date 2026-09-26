import {Injectable} from '@nestjs/common';
import dayjs from 'dayjs';
import {MonitorModelsService} from '../../models/mongo/monitor-models.service';
import {MonitorClickhouseService} from '../../models/clickhouse/monitor-clickhouse.service';

@Injectable()
export class RemoveService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly clickhouse: MonitorClickhouseService
  ) {}

  async customDelete(fil: any) {
    const {appId, type = '', resource = [], time = []} = fil;
    const query: any = {};
    let result: any = null;
    if (!time.length) {
      throw new Error('必须选择时间');
    }
    const startTime = dayjs(new Date(time[0]).valueOf()).format('YYYY-MM-DD 00:00:00');
    const endTime = dayjs(new Date(time[1]).valueOf()).format('YYYY-MM-DD 23:59:59');
    // Use createTime for Mongo queries (camelCase in new schema)
    query.createTime = {$lte: new Date(endTime), $gte: new Date(startTime)};

    if (type === 'web') {
      if (resource && resource.length > 0) {
        const arr: any = [];
        for (const item of resource) {
          // todo 因clickhouse改造，需要重构
          switch (item) {
            case 'ajax': {
              const ajaxModel = await this.clickhouse.WebAjax(appId);
              arr.push(
                Promise.resolve(
                  ajaxModel.delete({
                    where: `createTime<=toDateTime('${endTime}') and createTime>=toDateTime('${startTime}')`,
                  })
                )
              );
              break;
            }
            case 'page': {
              arr.push(Promise.resolve(this.models.WebPage(appId).deleteMany(query).exec()));
              break;
            }
            case 'env': {
              arr.push(Promise.resolve(this.models.WebEnvironment(appId).deleteMany(query).exec()));
              break;
            }
            case 'err': {
              const errorModel = await this.clickhouse.WebError(appId);
              arr.push(
                Promise.resolve(
                  errorModel.delete({
                    where: `createTime<=toDateTime('${endTime}') and createTime>=toDateTime('${startTime}')`,
                  })
                )
              );
              break;
            }
            case 'resource': {
              arr.push(Promise.resolve(this.models.WebResource(appId).deleteMany(query).exec()));
            }
          }
        }
        result = Promise.all(arr);
      }
    }
    return result;
  }
}
