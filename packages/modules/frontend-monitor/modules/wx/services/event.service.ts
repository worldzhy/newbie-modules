import {Injectable} from '@nestjs/common';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';

@Injectable()
export class WxEventService {
  constructor(private readonly ch: MonitorClickhouseService) {}

  async getEventList({
    appId,
    beginTime,
    endTime,
    pageNo,
    pageSize,
    event,
  }: {
    appId: string;
    beginTime?: string;
    endTime?: string;
    pageNo: number;
    pageSize: number;
    event?: string;
  }) {
    const wheres: string[] = [];
    let where: string | undefined;
    if (beginTime) wheres.push(`createTime>=toDateTime('${beginTime}')`);
    if (endTime) wheres.push(`createTime<=toDateTime('${endTime}')`);
    if (event) wheres.push(`ilike(event,'%${event}%')`);
    if (wheres.length > 0) where = wheres.join(' and ');
    const model = await this.ch.WxEvent(appId);
    const countQuery = model.find({select: 'count(*) AS total', where});
    const listQuery = model.find({where, limit: pageSize, skip: (pageNo - 1) * pageSize, orderBy: 'createTime DESC'});
    const [count, list] = await Promise.all([countQuery, listQuery]);
    return {list, pageNo, totalNum: count?.[0]?.total || 0};
  }
}
