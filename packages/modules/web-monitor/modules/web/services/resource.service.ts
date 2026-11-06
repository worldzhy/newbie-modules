import { Injectable } from "@nestjs/common";
import { WebMonitorModelsService } from "../../../models/mongo/web-monitor-models.service";
import { ConfigService } from "@nestjs/config";
import { func } from "../../../shared/utils";
import { WEB_MONITOR_CONFIG } from "../../../shared/web-monitor-config";

@Injectable()
export class ResourceService {
  private cfg: Record<string, unknown>;
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly config: ConfigService,
  ) {
    this.cfg = this.config.get("modules.web-monitor") || {};
  }

  async getResourceForType(
  appKey: string,
    url: string,
    speedType: number,
    pageNo: number,
    pageSize: number,
    beginTime?: string,
    endTime?: string,
  ) {
    const match: Record<string, unknown> = { url, speedType: Number(speedType) };
    if (beginTime && endTime) match.createTime = { $gte: new Date(beginTime), $lte: new Date(endTime) };
    const count = await this.models.WebResource(appKey).count(match).read("secondaryPreferred").exec();
    const dataList = await this.models
      .WebResource(appKey)
      .aggregate([
        { $match: match },
        { $sort: { createTime: -1 } },
        { $skip: (Number(pageNo) - 1) * Number(pageSize) },
        { $limit: Number(pageSize) },
      ])
      .read("secondaryPreferred")
      .exec();
    return { dataList, totalNum: count, pageNo: Number(pageNo) };
  }

  async getAverageResourceList(query: Record<string, unknown>) {
    const { appId: appKey, type = 1, pageNo = 1, pageSize = WEB_MONITOR_CONFIG.pageSize, beginTime, endTime, url } = query;
    const match: Record<string, unknown> = { speedType: Number(type) };
    if (url) match.name = { $regex: new RegExp(func.escapeRegExp(url), "i") };
    if (beginTime || endTime) {
      const createTime: Record<string, unknown> = {};
      if (beginTime) createTime.$gte = func.toDate(beginTime);
      if (endTime) createTime.$lte = func.toDate(endTime);
      match.createTime = createTime;
    }
    const group_id = { url: "$name", method: "$method" };
    const count = await this.models
      .WebResource(String(appKey))
      .distinct("name", match)
      .read("secondaryPreferred")
      .exec();
    const dataList = await this.models
      .WebResource(String(appKey))
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: group_id,
            count: { $sum: 1 },
            duration: { $avg: "$duration" },
            bodySize: { $avg: "$bodySize" },
          },
        },
        { $skip: (Number(pageNo) - 1) * Number(pageSize) },
        { $limit: Number(pageSize) },
        { $sort: { count: -1 } },
      ])
      .read("secondaryPreferred")
      .exec();
    return { dataList, totalNum: count.length, pageNo: Number(pageNo) };
  }

  async getOneResourceAvg(appKey: string, url: string, beginTime?: string, endTime?: string) {
    const match: Record<string, unknown> = { name: url };
    if (beginTime && endTime) match.createTime = { $gte: new Date(beginTime), $lte: new Date(endTime) };
    const rows = await this.models
      .WebResource(appKey)
      .aggregate([
        { $match: match },
        { $group: { _id: null, count: { $sum: 1 }, duration: { $avg: "$duration" }, bodySize: { $avg: "$bodySize" } } },
      ])
      .read("secondaryPreferred")
      .exec();
    return rows?.[0] || {};
  }

  async getOneResourceList(
  appKey: string,
    url: string,
    pageNo: number = 1,
    pageSize: number = WEB_MONITOR_CONFIG.pageSize,
    beginTime?: string,
    endTime?: string,
  ) {
    const match: Record<string, unknown> = { name: url };
    if (beginTime && endTime) match.createTime = { $gte: new Date(beginTime), $lte: new Date(endTime) };
    const count = await this.models.WebResource(appKey).count(match).read("secondaryPreferred").exec();
    const dataList = await this.models
      .WebResource(appKey)
      .aggregate([
        { $match: match },
        { $sort: { createTime: -1 } },
        { $skip: (Number(pageNo) - 1) * Number(pageSize) },
        { $limit: Number(pageSize) },
      ])
      .read("secondaryPreferred")
      .exec();
    return { dataList, totalNum: count, pageNo: Number(pageNo) };
  }

  async getOneResourceDetail(appKey: string, id: string) {
    return await this.models.WebResource(appKey).findOne({ _id: id }).read("secondaryPreferred").exec();
  }
}
