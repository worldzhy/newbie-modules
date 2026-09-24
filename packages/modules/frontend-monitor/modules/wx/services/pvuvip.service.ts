import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {DayReportNumService} from '../../../modules/day-report/day-report-num.service';
import {func} from '../../../shared/utils';

@Injectable()
export class WxPvuvipService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService,
    private readonly dayReportNum: DayReportNumService
  ) {}

  async getPvUvIpData(appId: string, beginTime: Date | string, endTime: Date | string) {
    const querydata = {
      appId: appId,
      type: 1,
      createTime: {$gte: new Date(beginTime), $lt: new Date(endTime)},
    };
    return await this.models.WxPvuvip().find(querydata).read('secondaryPreferred').exec();
  }

  async getPvUvIpSurveyOne(appId: string, beginTime: string | Date, endTime: string | Date) {
    const query = {
      appId: appId,
      type: 2,
      createTime: {$gte: new Date(beginTime), $lte: new Date(endTime)},
    };
    let num: any = 0;
    if (new Date().valueOf() >= new Date(beginTime).valueOf() && new Date().valueOf() < new Date(endTime).valueOf()) {
      const today = new Date(func.format(new Date(), 'yyyy/MM/dd')).getTime();
      num = await this.dayReportNum.getTodayFromRedis(appId, today);
    } else {
      const numResult = await this.dayReportNum.getDayFromMongo(appId, beginTime, endTime);
      num = numResult.num;
    }
    const data = await this.models.WxPvuvip().findOne(query).read('secondaryPreferred').exec();
    if (data) {
      const obj: any = data;
      obj.num = num;
      return obj;
    }
    const pvuvipdata = await this.getPvUvIpSurvey(appId, beginTime, endTime, true);
    const result = await this.savePvUvIpData(appId, new Date(beginTime), 2, pvuvipdata);
    return result;
  }

  async getHistoryPvUvIplist(appId: string) {
    const query = {appId, type: 2};
    const data = await this.models
      .WxPvuvip()
      .find(query)
      .read('secondaryPreferred')
      .sort({createTime: -1})
      .limit(5)
      .exec();
    const result = data.map(async (item: any) => {
      const {createTime, appId} = item;
      const obj = JSON.parse(JSON.stringify(item));
      if (createTime) {
        const num = await this.dayReportNum.getDayFromMongo(appId, createTime, createTime);
        obj.num = num.num;
      }
      return obj;
    });
    return await Promise.all(result);
  }

  async getPvUvIpSurvey(appId: string, beginTime: string | Date, endTime: string | Date, type?: boolean) {
    const querydata = {
      createTime: {$gte: new Date(beginTime), $lt: new Date(endTime)},
    };
    const pv = Promise.resolve(this.pv(appId, querydata));
    const uv = Promise.resolve(this.uv(appId, querydata));
    const ip = Promise.resolve(this.ip(appId, querydata));
    const ajax = Promise.resolve(this.ajax(appId, {beginTime, endTime}));
    const flow = Promise.resolve(this.flow(appId, {beginTime, endTime}));
    if (!type) {
      const data = await Promise.all([pv, uv, ip, ajax, flow]);
      return {
        pv: data[0] || 0,
        uv: data[1].length ? data[1][0].count : 0,
        ip: data[2].length ? data[2][0].count : 0,
        ajax: data[3] || 0,
        flow: data[4] || 0,
      };
    } else {
      const user = Promise.resolve(this.user(appId, querydata));
      const bounce = Promise.resolve(this.bounce(appId, querydata));
      const data = await Promise.all([pv, uv, ip, ajax, user, bounce, flow]);
      return {
        pv: data[0] || 0,
        uv: data[1].length ? data[1][0].count : 0,
        ip: data[2].length ? data[2][0].count : 0,
        ajax: data[3] || 0,
        user: data[4].length ? data[4][0].count : 0,
        bounce: data[5] || 0,
        flow: data[6] || 0,
      };
    }
  }

  async pv(appId: string, querydata: any) {
    return this.models.WxPage(appId).count(querydata).read('secondaryPreferred').exec();
  }

  async ajax(appId: string, {beginTime, endTime}: {beginTime: any; endTime: any}) {
    const beginStr = func.format(new Date(beginTime), 'yyyy/MM/dd hh:mm:ss');
    const endStr = func.format(new Date(endTime), 'yyyy/MM/dd hh:mm:ss');
    const model = await this.ch.WxAjax(appId);
    const rows = await model.find({
      select: 'count() as count',
      where: `createTime>=toDateTime('${beginStr}') and createTime<=toDateTime('${endStr}')`,
    });
    return rows?.[0]?.count || 0;
  }

  async uv(appId: string, querydata: any) {
    return this.models
      .WxPage(appId)
      .aggregate([
        {$match: querydata},
        {
          $group: {
            _id: {markUv: '$markUv', uid: '$uid', phone: '$phone'},
          },
        },
        {$group: {_id: null, count: {$sum: 1}}},
      ])
      .read('secondaryPreferred')
      .exec();
  }

  async ip(appId: string, querydata: any) {
    return this.models
      .WxPage(appId)
      .aggregate([
        {$match: querydata},
        {$project: {ip: true}},
        {$group: {_id: '$ip'}},
        {$group: {_id: null, count: {$sum: 1}}},
      ])
      .read('secondaryPreferred')
      .exec();
  }

  async user(appId: string, querydata: any) {
    return this.models
      .WxPage(appId)
      .aggregate([
        {$match: querydata},
        {$project: {markUser: true}},
        {$group: {_id: '$markUser'}},
        {$group: {_id: null, count: {$sum: 1}}},
      ])
      .read('secondaryPreferred')
      .exec();
  }

  async bounce(appId: string, $match: any) {
    const result = await this.models
      .WxPage(appId)
      .aggregate([
        {$match},
        {
          $group: {
            _id: {markUser: '$markUser'},
            urls: {$push: 1},
            count: {$sum: 1},
          },
        },
        {$match: {count: 1}},
        {$count: 'bounce'},
      ])
      .read('secondaryPreferred')
      .exec();
    if (result[0]) return result[0].bounce;
    return 0;
  }

  async flow(appId: string, {beginTime, endTime}: {beginTime: any; endTime: any}) {
    const beginStr = func.format(new Date(beginTime), 'yyyy/MM/dd hh:mm:ss');
    const endStr = func.format(new Date(endTime), 'yyyy/MM/dd hh:mm:ss');
    const model = await this.ch.WxAjax(appId);
    const ajaxflow = await model.find({
      select: 'sum(bodySize) as sum',
      where: `createTime>=toDateTime('${beginStr}') and createTime<=toDateTime('${endStr}')`,
    });
    return ajaxflow?.[0]?.sum || 0;
  }

  async savePvUvIpData(appId: string, endTime: Date, type: number, pvuvipdata: any) {
    const pvuvipModel = this.models.WxPvuvip();
    const pvuvip = new pvuvipModel();
    pvuvip.appId = appId;
    pvuvip.pv = pvuvipdata.pv || 0;
    pvuvip.uv = pvuvipdata.uv || 0;
    pvuvip.ip = pvuvipdata.ip || 0;
    pvuvip.ajax = pvuvipdata.ajax || 0;
    pvuvip.flow = pvuvipdata.flow || 0;
    pvuvip.bounce = pvuvipdata.bounce ? ((pvuvipdata.bounce / pvuvipdata.pv) * 100).toFixed(2) + '%' : 0;
    pvuvip.depth = pvuvipdata.pv && pvuvipdata.user ? Math.floor(pvuvipdata.pv / pvuvipdata.user) : 0;
    pvuvip.createTime = endTime;
    pvuvip.type = type;
    return await pvuvip.save();
  }

  async getTimeList(beginTime: any, endTime: any, dataList: any[], betweenTime: number) {
    const result: any[] = [];
    for (let t = new Date(beginTime).getTime(); t <= new Date(endTime).getTime(); t += betweenTime) {
      const date = new Date(t);
      const timer = func.format(date, 'yyyy/MM/dd hh:mm:ss');
      const items: any = {time: timer, pv: 0, uv: 0, ip: 0, ajax: 0, flow: 0};
      dataList.forEach((item: any) => {
        if (new Date(item.createTime).getTime() === date.getTime()) {
          items.pv = item.pv || 0;
          items.uv = item.uv || 0;
          items.ip = item.ip || 0;
          items.ajax = item.ajax || 0;
          items.flow = Math.floor((item.flow || 0) / 1024 / 1024);
        }
      });
      result.push(items);
    }
    const length = result.length;
    if (length > 1) {
      const last = result[length - 1];
      if (!last.pv) result.splice(length - 1, 1);
    }
    return result;
  }
}
