import {Injectable} from '@nestjs/common';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class ErrorService {
  private cfg: any;
  constructor(
    private readonly ch: MonitorClickhouseService,
    private readonly config: ConfigService
  ) {
    this.cfg = this.config.get('modules.web-monitor');
  }

  async getAverageErrorList(query: any) {
    const {
      appId,
      beginTime,
      endTime,
      type = '',
      realTime,
      resourceUrl,
      pageSize = this.cfg.pageSize,
      uid,
      phone,
    } = query;
    let pageNo = Number(query.pageNo || 1);
    const wheres: string[] = [];
    if (resourceUrl) wheres.push(`ilike(resourceUrl,'%${resourceUrl}%')`);
    if (phone) wheres.push(`ilike(phone,'%${phone}%')`);
    if (uid) wheres.push(`ilike(uid,'%${uid}%')`);
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    if (type) {
      const typeArr = String(type).split('|').join("','");
      wheres.push(`type IN('${typeArr}')`);
    }
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebError(appId);

    if (String(realTime) === '1') {
      const total = await model.find({where, select: 'count() as total'});
      const list = await model.find({
        where,
        select: '*',
        limit: pageSize,
        skip: (pageNo - 1) * pageSize,
        orderBy: 'createTime DESC',
      });
      list.forEach((item: any) => (item._id = {...item}));
      return {dataList: list, totalNum: total?.[0]?.total || 0, pageNo};
    }

    let groupBy = '';
    if (type === 'script') groupBy = 'resourceUrl,name,type';
    else if (type === 'resource') groupBy = 'resourceUrl,type';
    else if (type === 'ajax|fetch') groupBy = 'resourceUrl,status,type';
    else if (type === 'bussiness-ajax|bussiness-fetch') groupBy = 'resourceUrl,status,type';
    else if (type === 'log') groupBy = 'resourceUrl,type';

    const countQuery = model.find([{where, groupBy, select: 'COUNT()'}, {select: 'count() as total'}]);
    const listQuery = model.find({
      where,
      select: `${groupBy}, MAX(createTime) AS lastCreateTime,COUNT() AS count,COUNT(DISTINCT markUser) AS userNum,groupArray(msg)[1] AS lastMsg`,
      groupBy,
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: 'count DESC',
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: any) => (item._id = {...item}));
    return {dataList: list, totalNum: count?.[0]?.total || 0, pageNo};
  }

  async getOneErrorList(query: any) {
    const {appId, url, name = '', status = '', type = '', beginTime, endTime, phone = '', uid = ''} = query;
    let pageNo = Number(query.pageNo || 1);
    let pageSize = Number(query.pageSize || this.cfg.pageSize);
    const wheres: string[] = [];
    if (url) wheres.push(`resourceUrl='${url}'`);
    if (name) wheres.push(`name='${name}'`);
    if (status) wheres.push(`status='${status}'`);
    if (type) wheres.push(`type='${type}'`);
    if (phone) wheres.push(`ilike(phone,'%${phone}%')`);
    if (uid) wheres.push(`ilike(uid,'%${uid}%')`);
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebError(appId);
    const countQuery = model.find({where, select: 'count() as total'});
    const listQuery = model.find({
      where,
      select: '*',
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: 'createTime DESC',
    });
    const groupBy = 'resourceUrl';
    const otherQuery = model.find({
      where,
      select: `${groupBy},MIN(createTime) AS first,MAX(createTime) AS last,COUNT() AS count,COUNT(DISTINCT markUser) AS userNum`,
      limit: pageSize,
      groupBy,
    });
    const [count, list, other] = await Promise.all([countQuery, listQuery, otherQuery]);
    list.forEach((item: any) => (item._id = {...item}));
    let userNum = 0,
      first = '',
      last = '';
    if (other.length > 0) {
      userNum = other[0].userNum;
      first = other[0].first;
      last = other[0].last;
    }
    return {dataList: list, totalNum: count?.[0]?.total || 0, pageNo, first, last, userNum};
  }

  async getMarkUserErrorListCH(appId: string, opts: {markUser?: string; beginTime?: string; endTime?: string}) {
    const wheres: string[] = [];
    if (opts.markUser) wheres.push(`markUser='${opts.markUser}'`);
    if (opts.beginTime) wheres.push(`createTime>=toDateTime('${opts.beginTime}')`);
    if (opts.endTime) wheres.push(`createTime<toDateTime('${opts.endTime}')`);
    const where = wheres.length ? wheres.join(' and ') : undefined;
    const model = await this.ch.WebError(appId);
    const list = await model.find({where, select: '*', orderBy: 'createTime ASC'});
    return {list};
  }
}
