import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebMonitorClickhouseService } from "../../../models/clickhouse/web-monitor-clickhouse.service";

@Injectable()
export class AjaxService {
  private cfg: Record<string, unknown>;
  constructor(
    private readonly ch: WebMonitorClickhouseService,
    private readonly config: ConfigService,
  ) {
    this.cfg = this.config.get("modules.web-monitor") || {};
  }

  async getPageAjaxsAvg(appId: string, url?: string, beginTime?: string, endTime?: string) {
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (url) {
      wheres.push(`callUrl = {url:String}`);
      queryParams.url = url;
    }
    if (beginTime) {
      wheres.push(`createTime >= toDateTime({beginTime:String})`);
      queryParams.beginTime = beginTime;
    }
    if (endTime) {
      wheres.push(`createTime <= toDateTime({endTime:String})`);
      queryParams.endTime = endTime;
    }
    const where = wheres.length ? wheres.join(" AND ") : undefined;
    const model = await this.ch.WebAjax(appId);
    const countQuery = model.find([
      { where, select: "url", groupBy: "url,method", queryParams },
      { select: "count() as total" },
    ]);
    const listQuery = model.find({
      where,
      select: "url,method,count() as count,floor(avg(duration)) as durationAvg,floor(avg(bodySize)) as bodySize",
      groupBy: "url,method",
      orderBy: "durationAvg DESC",
      queryParams,
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: Record<string, unknown>) => {
      item._id = { method: item.method, url: item.url };
      item.duration = item.durationAvg;
    });
    return { dataList: list, totalNum: count?.[0]?.total || 0, pageNo: 1 };
  }

  async getAverageAjaxList(query: Record<string, unknown>) {
    const { appId, beginTime, endTime, type = 1, url, pageSize = this.cfg.pageSize } = query;
    const pageNo = Number(query.pageNo || 1);
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (parseInt(String(type)) === 2) wheres.push("duration > 2000");
    if (url) {
      wheres.push(`ilike(url, {url:String})`);
      queryParams.url = `%${url}%`;
    }
    if (beginTime) {
      wheres.push(`createTime >= toDateTime({beginTime:String})`);
      queryParams.beginTime = beginTime;
    }
    if (endTime) {
      wheres.push(`createTime <= toDateTime({endTime:String})`);
      queryParams.endTime = endTime;
    }
    const where = wheres.length ? wheres.join(" AND ") : undefined;
    const model = await this.ch.WebAjax(String(appId));
    const countQuery = model.find([
      { where, select: "url", groupBy: "url,method", queryParams },
      { select: "count() as total" },
    ]);
    const listQuery = model.find({
      where,
      select: "url,method,count() as count,floor(avg(duration)) as durationAvg,floor(avg(bodySize)) as bodySize",
      groupBy: "url,method",
      limit: Number(pageSize),
      skip: (pageNo - 1) * Number(pageSize),
      orderBy: "durationAvg DESC",
      queryParams,
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: Record<string, unknown>) => {
      item._id = { method: item.method, url: item.url };
      item.duration = item.durationAvg;
    });
    return { dataList: list, totalNum: count?.[0]?.total || 0, pageNo };
  }

  async getOneAjaxList(
    appId: string,
    url?: string,
    pageNo = 1,
    pageSize = 15,
    beginTime?: string,
    endTime?: string,
    type?: number,
  ) {
    pageNo = Number(pageNo);
    pageSize = Number(pageSize);
    type = Number(type || 1);
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (parseInt(String(type)) === 2) wheres.push("duration > 2000");
    if (url) {
      wheres.push(`ilike(url, {url:String})`);
      queryParams.url = `%${url}%`;
    }
    if (beginTime) {
      wheres.push(`createTime >= toDateTime({beginTime:String})`);
      queryParams.beginTime = beginTime;
    }
    if (endTime) {
      wheres.push(`createTime <= toDateTime({endTime:String})`);
      queryParams.endTime = endTime;
    }
    const where = wheres.length ? wheres.join(" AND ") : undefined;
    const model = await this.ch.WebAjax(appId);
    const countQuery = model.find([{ where, select: "url", queryParams }, { select: "count() as total" }]);
    const listQuery = model.find({
      where,
      select: "*",
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: "createTime DESC",
      queryParams,
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    return { dataList: list, totalNum: count?.[0]?.total || 0, pageNo };
  }

  async getMarkUserAjaxList(appId: string, opts: { markUser?: string; beginTime?: string; endTime?: string }) {
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (opts.markUser) {
      wheres.push(`markUser = {markUser:String}`);
      queryParams.markUser = opts.markUser;
    }
    if (opts.beginTime) {
      wheres.push(`createTime >= toDateTime({beginTime:String})`);
      queryParams.beginTime = opts.beginTime;
    }
    if (opts.endTime) {
      wheres.push(`createTime < toDateTime({endTime:String})`);
      queryParams.endTime = opts.endTime;
    }
    const where = wheres.length ? wheres.join(" AND ") : undefined;
    const model = await this.ch.WebAjax(appId);
    const list = await model.find({ where, select: "*", orderBy: "createTime ASC", queryParams });
    return { list };
  }
}
