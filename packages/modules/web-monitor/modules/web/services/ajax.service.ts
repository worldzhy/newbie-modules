import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';

@Injectable()
export class AjaxService {
  private cfg: any;
  constructor(
    private readonly ch: MonitorClickhouseService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('modules.web-monitor');
  }

  async getPageAjaxsAvg(appId: string, url?: string, beginTime?: string, endTime?: string) {
    const wheres: string[] = [];
    if (url) wheres.push(`callUrl='${url}'`);
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebAjax(appId);
    const countQuery = model.find([{where, select: 'url', groupBy: 'url,method'}, {select: 'count() as total'}]);
    const listQuery = model.find({
      where,
      select: 'url,method,count() as count,floor(avg(duration)) as durationAvg,floor(avg(bodySize)) as bodySize',
      groupBy: 'url,method',
      orderBy: 'durationAvg DESC',
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: any) => {
      item._id = {method: item.method, url: item.url};
      item.duration = item.durationAvg;
    });
    return {dataList: list, totalNum: count?.[0]?.total || 0, pageNo: 1};
  }

  async getAverageAjaxList(query: any) {
    const {appId, beginTime, endTime, type = 1, url, pageSize = this.cfg.pageSize} = query;
    let pageNo = Number(query.pageNo || 1);
    const wheres: string[] = [];
    if (parseInt(type) === 2) wheres.push('duration>2000');
    if (url) wheres.push(`ilike(url,'%${url}%')`);
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebAjax(appId);
    const countQuery = model.find([{where, select: 'url', groupBy: 'url,method'}, {select: 'count() as total'}]);
    const listQuery = model.find({
      where,
      select: 'url,method,count() as count,floor(avg(duration)) as durationAvg,floor(avg(bodySize)) as bodySize',
      groupBy: 'url,method',
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: 'durationAvg DESC',
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: any) => {
      item._id = {method: item.method, url: item.url};
      item.duration = item.durationAvg;
    });
    return {dataList: list, totalNum: count?.[0]?.total || 0, pageNo};
  }

  async getOneAjaxList(
    appId: string,
    url?: string,
    pageNo = 1,
    pageSize = 15,
    beginTime?: string,
    endTime?: string,
    type?: number
  ) {
    pageNo = Number(pageNo);
    pageSize = Number(pageSize);
    type = Number(type || 1);
    const wheres: string[] = [];
    if (parseInt(String(type)) === 2) wheres.push('duration>2000');
    if (url) wheres.push(`ilike(url,'%${url}%')`);
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebAjax(appId);
    const countQuery = model.find([{where, select: 'url'}, {select: 'count() as total'}]);
    const listQuery = model.find({
      where,
      select: '*',
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: 'createTime DESC',
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    return {dataList: list, totalNum: count?.[0]?.total || 0, pageNo};
  }

  async getMarkUserAjaxList(appId: string, opts: {markUser?: string; beginTime?: string; endTime?: string}) {
    const wheres: string[] = [];
    if (opts.markUser) wheres.push(`markUser='${opts.markUser}'`);
    if (opts.beginTime) wheres.push(`createTime>=toDateTime('${opts.beginTime}')`);
    if (opts.endTime) wheres.push(`createTime<toDateTime('${opts.endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebAjax(appId);
    const list = await model.find({where, select: '*', orderBy: 'createTime ASC'});
    return {list};
  }
}
