import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {ConfigService} from '@nestjs/config';
import {func} from '../../../shared/utils';

@Injectable()
export class WxPageService {
  private cfg: any;
  constructor(
    private readonly models: MonitorModelsService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }

  async getAveragePageList(query: any) {
    const {appId, pageNo = 1, pageSize = this.cfg.pageSize, url, city} = query;
    const match: any = {};
    if (url) match.path = {$regex: new RegExp(url, 'i')};
    if (city) match.city = city;
    func.setMatchTime(query, match);
    const group_id = {url: '$path'};
    return url || city
      ? await this.oneThread(appId, {$match: match}, Number(pageNo), Number(pageSize), group_id)
      : await this.moreThread(appId, {$match: match}, Number(pageNo), Number(pageSize), group_id);
  }

  private async moreThread(appId: string, queryjson: any, pageNo: number, pageSize: number, group_id: any) {
    const result: any[] = [];
    let distinct =
      (await this.models.WxPage(appId).distinct('path', queryjson.$match).read('secondaryPreferred').exec()) || [];
    const copdistinct = distinct.slice();
    const betinIndex = (pageNo - 1) * pageSize;
    if (distinct && distinct.length) distinct = distinct.slice(betinIndex, betinIndex + pageSize);
    const resolvelist = distinct.filter(Boolean).map((item: string) =>
      this.models
        .WxPage(appId)
        .aggregate([{$match: {path: item, ...queryjson.$match}}, {$group: {_id: group_id, count: {$sum: 1}}}])
        .read('secondaryPreferred')
        .exec()
    );
    const all = await Promise.all(resolvelist);
    all.forEach(item => result.push(item?.[0]));
    return {dataList: result, totalNum: copdistinct.length, pageNo};
  }

  private async oneThread(appId: string, queryjson: any, pageNo: number, pageSize: number, group_id: any) {
    const count = await this.models.WxPage(appId).distinct('path', queryjson.$match).read('secondaryPreferred').exec();
    const datas = await this.models
      .WxPage(appId)
      .aggregate([
        queryjson,
        {$group: {_id: group_id, count: {$sum: 1}}},
        {$skip: (pageNo - 1) * pageSize},
        {$sort: {count: -1}},
        {$limit: pageSize},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList: datas, totalNum: count.length, pageNo};
  }

  async getOnePageList(query: any) {
    const {appId, pageNo = 1, pageSize = this.cfg.pageSize, url} = query;
    const match: any = {path: url};
    func.setMatchTime(query, match);
    const count = await this.models.WxPage(appId).count(match).read('secondaryPreferred').exec();
    const datas = await this.models
      .WxPage(appId)
      .aggregate([
        {$match: match},
        {$sort: {createTime: -1}},
        {$skip: (Number(pageNo) - 1) * Number(pageSize)},
        {$limit: Number(pageSize)},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList: datas, totalNum: count, pageNo: Number(pageNo)};
  }

  async getPageDetails(appId: string, query: any) {
    return await this.models.WxPage(appId).findOne(query).read('secondaryPreferred').exec();
  }

  async getDataGroupBy(type: number, url: string, appId: string, beginTime?: string, endTime?: string) {
    const match: any = {path: url};
    if (beginTime && endTime)
      match.createTime = {
        $gte: new Date(beginTime),
        $lte: new Date(endTime),
      };
    const group_id: any = {url: '$path'};
    if (Number(type) === 1) group_id.city = '$city';
    else if (Number(type) === 2) group_id.brand = '$brand';
    else if (Number(type) === 3) group_id.system = '$system';
    const datas = await this.models
      .WxPage(appId)
      .aggregate([{$match: match}, {$group: {_id: group_id, count: {$sum: 1}}}, {$sort: {count: -1}}, {$limit: 10}])
      .read('secondaryPreferred')
      .exec();
    return datas;
  }
}
