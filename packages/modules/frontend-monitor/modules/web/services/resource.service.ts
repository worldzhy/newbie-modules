import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class ResourceService {
  private cfg: any;
  constructor(
    private readonly models: MonitorModelsService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }

  async getResourceForType(
    appId: string,
    url: string,
    speedType: number,
    pageNo: number,
    pageSize: number,
    beginTime?: string,
    endTime?: string
  ) {
    const match: any = {url, speedType: Number(speedType)};
    if (beginTime && endTime) match.createTime = {$gte: new Date(beginTime), $lte: new Date(endTime)};
    const count = await this.models.WebResource(appId).count(match).read('secondaryPreferred').exec();
    const dataList = await this.models
      .WebResource(appId)
      .aggregate([
        {$match: match},
        {$sort: {createTime: -1}},
        {$skip: (Number(pageNo) - 1) * Number(pageSize)},
        {$limit: Number(pageSize)},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList, totalNum: count, pageNo: Number(pageNo)};
  }

  async getAverageResourceList(query: any) {
    const {appId, type = 1, pageNo = 1, pageSize = this.cfg.pageSize, beginTime, endTime, url} = query;
    const match: any = {speedType: Number(type)};
    if (url) match.name = {$regex: new RegExp(url, 'i')};
    if (beginTime || endTime) {
      const createTime: any = {};
      if (beginTime) createTime.$gte = new Date(beginTime);
      if (endTime) createTime.$lte = new Date(endTime);
      match.createTime = createTime;
    }
    const group_id = {url: '$name', method: '$method'};
    const count = await this.models.WebResource(appId).distinct('name', match).read('secondaryPreferred').exec();
    const dataList = await this.models
      .WebResource(appId)
      .aggregate([
        {$match: match},
        {$group: {_id: group_id, count: {$sum: 1}, duration: {$avg: '$duration'}, bodySize: {$avg: '$bodySize'}}},
        {$skip: (Number(pageNo) - 1) * Number(pageSize)},
        {$limit: Number(pageSize)},
        {$sort: {count: -1}},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList, totalNum: count.length, pageNo: Number(pageNo)};
  }

  async getOneResourceAvg(appId: string, url: string, beginTime?: string, endTime?: string) {
    const match: any = {name: url};
    if (beginTime && endTime) match.createTime = {$gte: new Date(beginTime), $lte: new Date(endTime)};
    const rows = await this.models
      .WebResource(appId)
      .aggregate([
        {$match: match},
        {$group: {_id: null, count: {$sum: 1}, duration: {$avg: '$duration'}, bodySize: {$avg: '$bodySize'}}},
      ])
      .read('secondaryPreferred')
      .exec();
    return rows?.[0] || {};
  }

  async getOneResourceList(
    appId: string,
    url: string,
    pageNo = 1,
    pageSize = this.cfg.pageSize,
    beginTime?: string,
    endTime?: string
  ) {
    const match: any = {name: url};
    if (beginTime && endTime) match.createTime = {$gte: new Date(beginTime), $lte: new Date(endTime)};
    const count = await this.models.WebResource(appId).count(match).read('secondaryPreferred').exec();
    const dataList = await this.models
      .WebResource(appId)
      .aggregate([
        {$match: match},
        {$sort: {createTime: -1}},
        {$skip: (Number(pageNo) - 1) * Number(pageSize)},
        {$limit: Number(pageSize)},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList, totalNum: count, pageNo: Number(pageNo)};
  }

  async getOneResourceDetail(appId: string, id: string) {
    return await this.models.WebResource(appId).findOne({_id: id}).read('secondaryPreferred').exec();
  }
}
