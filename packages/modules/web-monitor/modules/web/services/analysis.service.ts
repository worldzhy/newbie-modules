import { Injectable } from "@nestjs/common";
import { WebMonitorModelsService } from "../../../models/mongo/web-monitor-models.service";
import { ConfigService } from "@nestjs/config";
import { func } from "../../../shared/utils";
import { WEB_MONITOR_CONFIG } from "../../../shared/web-monitor-config";

@Injectable()
export class WebMonitorAnalysisService {
  private cfg: Record<string, unknown>;
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly config: ConfigService,
  ) {
    this.cfg = this.config.get("modules.web-monitor") || {};
  }

  private get topAnalysisLimit() {
    const size = WEB_MONITOR_CONFIG.top_alalysis_size;
    return func.isObject(size) ? Number(size.web) || 10 : 10;
  }

  async getAnalysislist(
    appKey: string,
    beginTime?: string,
    endTime?: string,
    filter?: { phone?: string; uid?: string },
  ) {
    const query: { $match: Record<string, unknown> } = { $match: {} };
    if (filter?.phone) query.$match.phone = filter.phone;
    if (filter?.uid) query.$match.uid = filter.uid;
    const createTime: Record<string, unknown> = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime);
      query.$match.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime);
      query.$match.createTime = createTime;
    }
    const result = await this.models
      .WebEnvironment(appId)
      .aggregate([
        query,
        { $group: { _id: { markUser: "$markUser" }, visitTime: { $first: "$createTime" } } },
        { $sort: { visitTime: 1 } },
      ])
      .read("secondaryPreferred")
      .exec();
    return { list: result };
  }

  async getAnalysisOneList(appKey: string, markUser: string) {
    return await this.models
      .WebEnvironment(appId)
      .find({ markUser })
      .read("secondaryPreferred")
      .sort({ createTime: 1 })
      .exec();
  }

  async getTopDatas(appKey: string, beginTime?: string, endTime?: string) {
    const top_pages = await this.getRealTimeTopPagesForDb(appId, beginTime, endTime);
    const top_jump_out = await this.getRealTimeTopJumpOutForDb(appId, beginTime, endTime);
    const top_browser = await this.getRealTimeTopBrowserForDb(appId, beginTime, endTime);
    const provinces = await this.getRealTimeTopProvinceForDb(appId, beginTime, endTime);
    return { top_pages, top_jump_out, top_browser, provinces };
  }

  async getProvinceCount(appKey: string, beginTime?: string, endTime?: string) {
    const res = await this.getRealTimeTopProvinceForDb(appId, beginTime, endTime);
    return { provinces: res };
  }

  private getMatch(beginTime?: string, endTime?: string) {
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

  private async getRealTimeTopPagesForDb(appKey: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    return await this.models
      .WebPage(appId)
      .aggregate([
        { $match: { ...$match } },
        { $group: { _id: { url: "$url" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: this.topAnalysisLimit },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  private async getRealTimeTopJumpOutForDb(appKey: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    return await this.models
      .WebEnvironment(appId)
      .aggregate([
        { $match: $match },
        { $group: { _id: { markUser: "$markUser" }, urls: { $push: "$url" }, count: { $sum: 1 } } },
        { $match: { count: 1 } },
        { $group: { _id: { value: { $arrayElemAt: ["$urls", 0] } }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: this.topAnalysisLimit },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  private async getRealTimeTopBrowserForDb(appKey: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    return await this.models
      .WebEnvironment(appId)
      .aggregate([
        { $match: { ...$match } },
        { $group: { _id: { browser: "$browser" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: this.topAnalysisLimit },
      ])
      .read("secondaryPreferred")
      .exec();
  }

  private async getRealTimeTopProvinceForDb(appKey: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    return await this.models
      .WebEnvironment(appId)
      .aggregate([
        { $match: { ...$match } },
        { $group: { _id: { province: "$province" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: this.topAnalysisLimit },
      ])
      .read("secondaryPreferred")
      .exec();
  }
}
