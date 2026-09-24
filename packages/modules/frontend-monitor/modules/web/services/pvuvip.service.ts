import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {DayReportNumService} from '../../../modules/day-report/day-report-num.service';
import {func} from '../../../shared/utils';

@Injectable()
export class PvuvipService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService,
    private readonly dayReportNum: DayReportNumService
  ) {}

  async getPvUvIpData(appId: string, beginTime: Date, endTime: Date) {
    return await this.models
      .WebPvuvip()
      .find({
        appId: appId,
        type: 1,
        createTime: {$gte: beginTime, $lte: endTime},
      })
      .read('secondaryPreferred')
      .exec();
  }

  async getHistoryPvUvIplist(appId: string) {
    const data = await this.models
      .WebPvuvip()
      .find({appId, type: 2})
      .read('secondaryPreferred')
      .sort({createTime: -1})
      .limit(5)
      .exec();
    const result = data.map(async (item: any) => {
      const obj = JSON.parse(JSON.stringify(item));
      if (item.createTime) {
        const num = await this.dayReportNum.getDayFromMongo(item.appId, item.createTime, item.createTime);
        obj.num = num.num;
      }
      return obj;
    });
    return await Promise.all(result);
  }

  async getHistoryPvUvIplistByRange(appId: string, beginTime: Date, endTime: Date) {
    const start = new Date(func.format(beginTime, 'yyyy/MM/dd 00:00:00'));
    const end = new Date(func.format(endTime, 'yyyy/MM/dd 23:59:59'));
    const days: any[] = [];
    for (let d = new Date(start); d.valueOf() <= end.valueOf(); d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(func.format(d, 'yyyy/MM/dd 00:00:00'));
      const dayEnd = new Date(func.format(d, 'yyyy/MM/dd 23:59:59'));
      const survey = await this.getPvUvIpSurvey(appId, dayStart, dayEnd, true);
      const numRes = await this.dayReportNum.getDayFromMongo(appId, dayStart, dayEnd);
      days.push({
        time: func.format(dayStart, 'yyyy/MM/dd'),
        ...survey,
        num: numRes?.num || 0,
      });
    }
    return days;
  }

  async getPvUvIpSurveyOne(appId: string, beginTime: Date, endTime: Date) {
    const query = {
      appId: appId,
      type: 2,
      createTime: {$gte: beginTime, $lte: endTime},
    };
    let num: string | number = 0;
    if (new Date().valueOf() >= beginTime.valueOf() && new Date().valueOf() < endTime.valueOf()) {
      const today = new Date(func.format(new Date(), 'yyyy/MM/dd')).getTime();
      num = (await this.dayReportNum.getTodayFromRedis(appId, today)) as string;
    } else {
      const numResult = await this.dayReportNum.getDayFromMongo(appId, beginTime, endTime);
      num = numResult.num;
    }
    const data = await this.models.WebPvuvip().findOne(query).read('secondaryPreferred').exec();
    if (data) {
      const obj: any = data.toObject();
      obj.num = num;
      return obj;
    }
    const pvuvipdata = await this.getPvUvIpSurvey(appId, beginTime, endTime, true);
    const result = await this.savePvUvIpData(appId, beginTime, 2, pvuvipdata);
    return result;
  }

  async getPvUvIpSurvey(appId: string, beginTime: Date, endTime: Date, history = false) {
    const $match = this.getMatch(beginTime, endTime);
    const querydata = {...$match};
    const pvPro = Promise.resolve(this.pv(appId, querydata));
    const uvPro = Promise.resolve(this.uv(appId, querydata));
    const ipPro = Promise.resolve(this.ip(appId, querydata));
    const ajaxPro = Promise.resolve(this.ajax(appId, {beginTime, endTime}));
    const flowPro = Promise.resolve(this.flow(appId, {beginTime, endTime}));

    if (!history) {
      const data = await Promise.all([pvPro, uvPro, ipPro, ajaxPro, flowPro]);
      return {
        pv: data[0] || 0,
        uv: data[1]?.[0]?.count || 0,
        ip: data[2]?.[0]?.count || 0,
        ajax: data[3] || 0,
        flow: data[4] || 0,
      };
    } else {
      const userPro = Promise.resolve(this.user(appId, querydata));
      const bouncePro = Promise.resolve(this.bounce(appId, querydata));
      const data = await Promise.all([pvPro, uvPro, ipPro, ajaxPro, userPro, bouncePro, flowPro]);
      return {
        pv: data[0] || 0,
        uv: data[1]?.[0]?.count || 0,
        ip: data[2]?.[0]?.count || 0,
        ajax: data[3] || 0,
        user: data[4]?.[0]?.count || 0,
        bounce: data[5] || 0,
        flow: data[6] || 0,
      };
    }
  }

  async savePvUvIpData(appId: string, endTime: Date, type: number, pvuvipdata: any) {
    const pvuvipModel = this.models.WebPvuvip();
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

  getMatch(beginTime?: Date | string, endTime?: Date | string) {
    const $match: any = {};
    const createTime: any = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime as any);
      $match.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime as any);
      $match.createTime = createTime;
    }
    return $match;
  }

  async pv(appId: string, querydata: any) {
    return this.models.WebPage(appId).count(querydata).read('secondaryPreferred').exec();
  }

  async ajax(appId: string, times: {beginTime: Date | string; endTime: Date | string}) {
    const beginStr = func.format(new Date(times.beginTime), 'yyyy/MM/dd hh:mm:ss');
    const endStr = func.format(new Date(times.endTime), 'yyyy/MM/dd hh:mm:ss');
    const model = await this.ch.WebAjax(appId);
    const rows = await model.find({
      select: 'count() as count',
      where: `createTime>=toDateTime('${beginStr}') and createTime<=toDateTime('${endStr}')`,
    });
    return rows?.[0]?.count || 0;
  }

  async uv(appId: string, querydata: any) {
    return this.models
      .WebEnvironment(appId)
      .aggregate([
        {$match: querydata},
        {$group: {_id: {markUv: '$markUv', uid: '$uid', phone: '$phone'}}},
        {$group: {_id: null, count: {$sum: 1}}},
      ])
      .read('secondaryPreferred')
      .exec();
  }

  async ip(appId: string, querydata: any) {
    return this.models
      .WebEnvironment(appId)
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
      .WebEnvironment(appId)
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
      .WebEnvironment(appId)
      .aggregate([
        {$match},
        {$group: {_id: {markUser: '$markUser'}, urls: {$push: 1}, count: {$sum: 1}}},
        {$match: {count: 1}},
        {$count: 'bounce'},
      ])
      .read('secondaryPreferred')
      .exec();
    return result?.[0]?.bounce || 0;
  }

  async flow(appId: string, times: {beginTime: Date | string; endTime: Date | string}) {
    const beginStr = func.format(new Date(times.beginTime), 'yyyy/MM/dd hh:mm:ss');
    const endStr = func.format(new Date(times.endTime), 'yyyy/MM/dd hh:mm:ss');
    const model = await this.ch.WebAjax(appId);
    const rows = await model.find({
      select: 'sum(bodySize) as sum',
      where: `createTime>=toDateTime('${beginStr}') and createTime<=toDateTime('${endStr}')`,
    });
    return rows?.[0]?.sum || 0;
  }
}
