import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class WxAnalysisService {
  private cfg: any;
  constructor(
    private readonly models: MonitorModelsService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }

  async getAnalysislist(appId: string, beginTime?: string, endTime?: string, filter?: {phone?: string; uid?: string}) {
    const query: any = {$match: {}};
    if (filter?.phone) query.$match.phone = filter.phone;
    if (filter?.uid) query.$match.uid = filter.uid;
    const createTime: any = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime);
      query.$match.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime);
      query.$match.createTime = createTime;
    }
    return await this.fixDistinct(appId, query);
  }

  private async fixDistinct(appId: string, query: any) {
    const result = await this.models
      .WxPage(appId)
      .aggregate([
        query,
        {
          $group: {
            _id: {markUser: '$markUser'},
            visitTime: {$first: '$createTime'},
          },
        },
        {$sort: {visitTime: 1}},
      ])
      .read('secondaryPreferred')
      .exec();
    return {list: result};
  }

  async getAnalysisOneList(appId: string, markUser: string) {
    return await this.models.WxPage(appId).find({markUser}).read('secondaryPreferred').sort({createTime: 1}).exec();
  }

  async getTopDatas(appId: string, beginTime?: string, endTime?: string) {
    const top_pages = await this.getRealTimeTopPagesForDb(appId, beginTime, endTime);
    const top_jump_out = await this.getRealTimeTopJumpOutForDb(appId, beginTime, endTime);
    const top_brand = await this.getRealTimeTopBrandForDb(appId, beginTime, endTime);
    const provinces = await this.getRealTimeTopProvinceForDb(appId, beginTime, endTime);
    return {top_pages, top_jump_out, top_brand, provinces};
  }

  private async getRealTimeTopPagesForDb(appId: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    const result = await this.models
      .WxPage(appId)
      .aggregate([
        {$match},
        {$group: {_id: {url: '$path'}, count: {$sum: 1}}},
        {$sort: {count: -1}},
        {$limit: this.cfg.top_alalysis_size?.wx || 10},
      ])
      .read('secondaryPreferred')
      .exec();
    return result;
  }

  private async getRealTimeTopJumpOutForDb(appId: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    const result = await this.models
      .WxPage(appId)
      .aggregate([
        {$match: $match},
        {
          $group: {
            _id: {markUser: '$markUser'},
            paths: {$push: '$path'},
            count: {$sum: 1},
          },
        },
        {$match: {count: 1}},
        {
          $group: {
            _id: {value: {$arrayElemAt: ['$paths', 0]}},
            count: {$sum: 1},
          },
        },
        {$sort: {count: -1}},
        {$limit: this.cfg.top_alalysis_size?.wx || 10},
      ])
      .read('secondaryPreferred')
      .exec();
    return result;
  }

  private async getRealTimeTopBrandForDb(appId: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    const result = await this.models
      .WxPage(appId)
      .aggregate([
        {$match},
        {$group: {_id: {brand: '$brand'}, count: {$sum: 1}}},
        {$sort: {count: -1}},
        {$limit: this.cfg.top_alalysis_size?.wx || 10},
      ])
      .read('secondaryPreferred')
      .exec();
    return result;
  }

  private async getRealTimeTopProvinceForDb(appId: string, beginTime?: string, endTime?: string) {
    const $match = this.getMatch(beginTime, endTime);
    const result = await this.models
      .WxPage(appId)
      .aggregate([{$match}, {$group: {_id: {province: '$province'}, count: {$sum: 1}}}, {$sort: {count: -1}}])
      .read('secondaryPreferred')
      .exec();
    return result;
  }

  async getProvinceCount(appId: string, beginTime?: string, endTime?: string) {
    const res = await this.getRealTimeTopProvinceForDb(appId, beginTime, endTime);
    return {provinces: res};
  }

  private getMatch(beginTime?: string, endTime?: string) {
    const $match: any = {};
    const createTime: any = {};
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
}
