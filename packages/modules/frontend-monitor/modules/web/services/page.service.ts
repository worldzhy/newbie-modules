import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {ConfigService} from '@nestjs/config';
import {func} from '../../../shared/utils';

@Injectable()
export class PageService {
  private cfg: any;
  constructor(
    private readonly models: MonitorModelsService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('modules.frontend-monitor');
  }

  async getAveragePageList(query: any) {
    const {appId, type = '', pageNo = 1, pageSize = this.cfg.pageSize, url, isFirstIn} = query;
    const match: any = {};
    if (isFirstIn !== undefined && isFirstIn !== '') {
      match.isFirstIn = isFirstIn === 'true' ? true : false;
    }
    func.setMatchTime(query, match);
    if (type) match.speedType = Number(type);
    if (url) match.url = {$regex: new RegExp(url, 'i')};
    const group_id = {url: '$url'};
    return url
      ? await this.oneThread(appId, match, Number(pageNo), Number(pageSize), group_id)
      : await this.getPages(appId, match, Number(pageNo), Number(pageSize));
  }

  private async getPages(appId: string, match: any, pageNo: number, pageSize: number) {
    const model = this.models.WebPage(appId);
    const distinct = (await model.distinct('url', match).read('secondaryPreferred').exec()) || [];
    const copdistinct = distinct.slice();
    const slice = distinct.slice((pageNo - 1) * pageSize, (pageNo - 1) * pageSize + pageSize);
    let $group: any = {
      _id: {url: '$url'},
      count: {$sum: 1},
    };
    // if has isFirstIn is first mode,or is visit mode
    if (match.hasOwnProperty('isFirstIn')) {
      $group = {
        ...$group,
        loadTime: {$avg: '$loadTime'},
        dnsTime: {$avg: '$dnsTime'},
        tcpTime: {$avg: '$tcpTime'},
        whiteTime: {$avg: '$whiteTime'},
        requestTime: {$avg: '$requestTime'},
        analysisDomTime: {$avg: '$analysisDomTime'},
      };
    }
    const jobs = slice.map((url: string) =>
      this.models
        .WebPage(appId)
        .aggregate([
          {$match: {...match, url}},
          {
            $group,
          },
        ])
        .read('secondaryPreferred')
        .exec()
    );
    const all = await Promise.all(jobs);
    const result = all.map(item => item?.[0]).filter(Boolean);
    return {dataList: result, totalNum: copdistinct.length, pageNo};
  }

  private async oneThread(appId: string, match: any, pageNo: number, pageSize: number, group_id: any) {
    const count = await this.models.WebPage(appId).distinct('url', match).read('secondaryPreferred').exec();
    const dataList = await this.models
      .WebPage(appId)
      .aggregate([
        {$match: match},
        {
          $group: {
            _id: group_id,
            count: {$sum: 1},
            loadTime: {$avg: '$loadTime'},
            dnsTime: {$avg: '$dnsTime'},
            tcpTime: {$avg: '$tcpTime'},
            domTime: {$avg: '$domTime'},
            whiteTime: {$avg: '$whiteTime'},
            requestTime: {$avg: '$requestTime'},
            analysisDomTime: {$avg: '$analysisDomTime'},
            readyTime: {$avg: '$readyTime'},
          },
        },
        {$skip: (pageNo - 1) * pageSize},
        {$sort: {count: -1}},
        {$limit: pageSize},
      ])
      .read('secondaryPreferred')
      .exec();
    return {dataList, totalNum: count.length, pageNo};
  }

  async getRealTimeAveragePageList(query: any) {
    const {appId, type = '', beginTime, endTime} = query;
    const match: any = {isFirstIn: true};
    if (type) match.speedType = Number(type);
    const _querys: any = this.getSpaceTime(beginTime, endTime, 60000);
    const result = await this.models
      .WebPage(appId)
      .aggregate([
        {$match: match},
        {
          $group: {
            _id: {
              year: {$year: '$createTime'},
              dayOfMonth: {$dayOfMonth: '$createTime'},
              month: {$month: '$createTime'},
              hour: {$hour: '$createTime'},
              interval: {
                $subtract: [{$minute: '$createTime'}, {$mod: [{$minute: '$createTime'}, 1]}],
              },
            },
            count: {$sum: 1},
            createTime: {$addToSet: '$createTime'},
            loadTime: {$avg: '$loadTime'},
            dnsTime: {$avg: '$dnsTime'},
            tcpTime: {$avg: '$tcpTime'},
            whiteTime: {$avg: '$whiteTime'},
            requestTime: {$avg: '$requestTime'},
            analysisDomTime: {$avg: '$analysisDomTime'},
          },
        },
        {
          $project: {
            count: '$count',
            createTime: {$slice: ['$createTime', 0, 1]},
            loadTime: '$loadTime',
            dnsTime: '$dnsTime',
            tcpTime: '$tcpTime',
            whiteTime: '$whiteTime',
            requestTime: '$requestTime',
            analysisDomTime: '$analysisDomTime',
          },
        },
      ])
      .read('secondaryPreferred')
      .exec();
    for (let i = 0; i < _querys.length; i++) {
      for (let r_i = 0; r_i < result.length; r_i++) {
        const rDate = new Date(result[r_i].createTime).getTime();
        if (rDate > _querys[i].beginTime && rDate < _querys[i].endTime) {
          _querys[i].result = result[r_i];
          result.splice(r_i, 1);
          break;
        }
      }
      if (!result.length) break;
    }
    return _querys.map(item => ({
      beginTime: func.format(new Date(item.beginTime), 'yyyy/MM/dd hh:mm'),
      endTime: func.format(new Date(item.endTime), 'yyyy/MM/dd hh:mm'),
      count: item.result ? item.result.count : 0,
      dnsTime: item.result ? item.result.dnsTime : 0,
      loadTime: item.result ? item.result.loadTime : 0,
      requestTime: item.result ? item.result.requestTime : 0,
      tcpTime: item.result ? item.result.tcpTime : 0,
      whiteTime: item.result ? item.result.whiteTime : 0,
    }));
  }

  async getOnePageList(query: any) {
    const {appId, type, pageNo = 1, pageSize = this.cfg.pageSize, url, isFirstIn, beginTime, endTime} = query;
    const match: any = {url};
    if (isFirstIn !== undefined && isFirstIn !== '') {
      const isFirstInNum = Number(isFirstIn);
      if (!isNaN(isFirstInNum)) {
        match.isFirstIn = isFirstInNum === 2;
      } else {
        match.isFirstIn = isFirstIn === 'true' || isFirstIn === true;
      }
    }
    if (type) match.speedType = Number(type);
    if (beginTime && endTime)
      match.createTime = {
        $gte: new Date(beginTime),
        $lte: new Date(endTime),
      };
    const count = await this.models.WebPage(appId).count(match).read('secondaryPreferred').exec();
    const dataList = await this.models
      .WebPage(appId)
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

  async getPageDetails(appId: string, id: string) {
    return await this.models.WebPage(appId).findOne({_id: id}).read('secondaryPreferred').exec();
  }

  private getSpaceTime(beginTime?: string, endTime?: string, spaceTime = 60000) {
    const begin = new Date(beginTime || new Date()).getTime();
    const end = new Date(endTime || new Date()).getTime();
    const list: any = [];
    for (let t = begin; t <= end; t += spaceTime) {
      list.push({beginTime: t, endTime: t + spaceTime, result: null});
    }
    return list;
  }
}
