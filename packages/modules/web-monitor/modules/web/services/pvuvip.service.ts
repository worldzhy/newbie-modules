import { Injectable } from "@nestjs/common";
import { WebMonitorModelsService } from "../../../models/mongo/web-monitor-models.service";
import { WebMonitorClickHouseService } from "../../../models/clickhouse/web-monitor-clickhouse.service";
import { DayReportNumService } from "@modules/web-monitor/modules/day-report/day-report-num.service";
import { func } from "../../../shared/utils";

@Injectable()
export class PvuvipService {
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly ch: WebMonitorClickHouseService,
    private readonly dayReportNum: DayReportNumService,
  ) {}

  async getPvUvIpData(appKey: string, beginTime: Date, endTime: Date) {
    return await this.models
      .WebPvuvip()
      .find({
        appId: appKey,
        type: 1,
        createTime: { $gte: beginTime, $lte: endTime },
      })
      .read("secondaryPreferred")
      .exec();
  }

  async getHistoryPvUvIplist(appKey: string) {
    const data = await this.models
      .WebPvuvip()
      .find({ appKey, type: 2 })
      .read("secondaryPreferred")
      .sort({ createTime: -1 })
      .limit(5)
      .exec();
    const result = data.map(async (item) => {
      const obj = JSON.parse(JSON.stringify(item));
      if (item.createTime) {
        const num = await this.dayReportNum.getDayFromMongo(item.appKey, item.createTime, item.createTime);
        obj.num = num?.num;
      }
      return obj;
    });
    return await Promise.all(result);
  }

  async getHistoryPvUvIplistByRange(appKey: string, beginTime: Date, endTime: Date) {
    const start = new Date(func.format(beginTime, "yyyy/MM/dd 00:00:00"));
    const end = new Date(func.format(endTime, "yyyy/MM/dd 23:59:59"));
    const days: Record<string, unknown>[] = [];
    for (let d = new Date(start); d.valueOf() <= end.valueOf(); d.setDate(d.getDate() + 1)) {
      const dayStart = new Date(func.format(d, "yyyy/MM/dd 00:00:00"));
      const dayEnd = new Date(func.format(d, "yyyy/MM/dd 23:59:59"));
      const survey = await this.getPvUvIpSurvey(appKey, dayStart, dayEnd, true);
      const numRes = await this.dayReportNum.getDayFromMongo(appKey, dayStart, dayEnd);
      days.push({
        time: func.format(dayStart, "yyyy/MM/dd"),
        ...survey,
        num: numRes?.num || 0,
      });
    }
    return days;
  }

  async getPvUvIpSurveyOne(appKey: string, beginTime: Date, endTime: Date) {
    const query = {
      appId: appKey,
      type: 2,
      createTime: { $gte: beginTime, $lte: endTime },
    };
    let num: string | number = 0;
    if (new Date().valueOf() >= beginTime.valueOf() && new Date().valueOf() < endTime.valueOf()) {
      const today = new Date(func.format(new Date(), "yyyy/MM/dd")).getTime();
      num = (await this.dayReportNum.getTodayFromRedis(appKey, today)) as string;
    } else {
      const numResult = await this.dayReportNum.getDayFromMongo(appKey, beginTime, endTime);
      num = numResult?.num || 0;
    }
    const data = await this.models.WebPvuvip().findOne(query).read("secondaryPreferred").exec();
    if (data) {
      const obj: Record<string, unknown> = data.toObject();
      obj.num = num;
      return obj;
    }
    const pvuvipdata = await this.getPvUvIpSurvey(appKey, beginTime, endTime, true);
    const result = await this.savePvUvIpData(appKey, beginTime, 2, pvuvipdata);
    return result;
  }

  async getPvUvIpSurvey(appKey: string, beginTime: Date, endTime: Date, history = false) {
    const $match = this.getMatch(beginTime, endTime);
    const querydata = { ...$match };
    const pvPro = Promise.resolve(this.pv(appKey, querydata));
    const uvPro = Promise.resolve(this.uv(appKey, querydata));
    const ipPro = Promise.resolve(this.ip(appKey, querydata));
    const ajaxPro = Promise.resolve(this.ajax(appKey, { beginTime, endTime }));
    const flowPro = Promise.resolve(this.flow(appKey, { beginTime, endTime }));

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
      const userPro = Promise.resolve(this.user(appKey, querydata));
      const bouncePro = Promise.resolve(this.bounce(appKey, querydata));
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

  async savePvUvIpData(appKey: string, endTime: Date, type: number, pvuvipdata: Record<string, unknown>) {
    const pvuvipModel = this.models.WebPvuvip();
    const pvuvip = new pvuvipModel();
    pvuvip.appKey = appKey;
    pvuvip.pv = Number(pvuvipdata.pv) || 0;
    pvuvip.uv = Number(pvuvipdata.uv) || 0;
    pvuvip.ip = Number(pvuvipdata.ip) || 0;
    pvuvip.ajax = Number(pvuvipdata.ajax) || 0;
    pvuvip.flow = Number(pvuvipdata.flow) || 0;
    pvuvip.bounce = pvuvipdata.bounce
      ? ((Number(pvuvipdata.bounce) / Number(pvuvipdata.pv)) * 100).toFixed(2) + "%"
      : "0";
    pvuvip.depth =
      Number(pvuvipdata.pv) && Number(pvuvipdata.user)
        ? Math.floor(Number(pvuvipdata.pv) / Number(pvuvipdata.user))
        : 0;
    pvuvip.createTime = endTime;
    pvuvip.type = type;
    return await pvuvip.save();
  }

  getMatch(beginTime?: Date | string, endTime?: Date | string) {
    const $match: Record<string, unknown> = {};
    const createTime: Record<string, unknown> = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime);
      $match.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime);
      $match.createTime = createTime;
    }
    return $match;
  }

  async pv(appKey: string, querydata: Record<string, unknown>) {
    return this.models.WebPage(appKey).count(querydata).read("secondaryPreferred").exec();
  }

  async ajax(appKey: string, times: { beginTime: Date | string; endTime: Date | string }) {
    const beginStr = func.format(new Date(times.beginTime), "yyyy/MM/dd hh:mm:ss");
    const endStr = func.format(new Date(times.endTime), "yyyy/MM/dd hh:mm:ss");
    const model = await this.ch.WebAjax(appKey);
    const rows = await model.find({
      select: "count() as count",
      where: `createTime >= toDateTime({beginTime:String}) AND createTime <= toDateTime({endTime:String})`,
      queryParams: { beginTime: beginStr, endTime: endStr },
    });
    return rows?.[0]?.count || 0;
  }

  async uv(appKey: string, querydata: Record<string, unknown>) {
    return this.models
      .WebEnvironment(appKey)
      .aggregate([
        { $match: querydata },
        { $group: { _id: { markUv: "$markUv", uid: "$uid", phone: "$phone" } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  async ip(appKey: string, querydata: Record<string, unknown>) {
    return this.models
      .WebEnvironment(appKey)
      .aggregate([
        { $match: querydata },
        { $project: { ip: true } },
        { $group: { _id: "$ip" } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  async user(appKey: string, querydata: Record<string, unknown>) {
    return this.models
      .WebEnvironment(appKey)
      .aggregate([
        { $match: querydata },
        { $project: { markUser: true } },
        { $group: { _id: "$markUser" } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  async bounce(appKey: string, $match: Record<string, unknown>) {
    const result = await this.models
      .WebEnvironment(appKey)
      .aggregate([
        { $match },
        { $group: { _id: { markUser: "$markUser" }, urls: { $push: 1 }, count: { $sum: 1 } } },
        { $match: { count: 1 } },
        { $count: "bounce" },
      ])
      .read("secondaryPreferred")
      .exec();
    return result?.[0]?.bounce || 0;
  }

  async flow(appKey: string, times: { beginTime: Date | string; endTime: Date | string }) {
    const beginStr = func.format(new Date(times.beginTime), "yyyy/MM/dd hh:mm:ss");
    const endStr = func.format(new Date(times.endTime), "yyyy/MM/dd hh:mm:ss");
    const model = await this.ch.WebAjax(appKey);
    const rows = await model.find({
      select: "sum(bodySize) as sum",
      where: `createTime >= toDateTime({beginTime:String}) AND createTime <= toDateTime({endTime:String})`,
      queryParams: { beginTime: beginStr, endTime: endStr },
    });
    return rows?.[0]?.sum || 0;
  }
}
