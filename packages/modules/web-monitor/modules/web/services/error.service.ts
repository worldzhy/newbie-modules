import { Injectable } from "@nestjs/common";
import { WebMonitorClickhouseService } from "../../../models/clickhouse/web-monitor-clickhouse.service";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ErrorService {
  private cfg: Record<string, unknown>;
  constructor(
    private readonly ch: WebMonitorClickhouseService,
    private readonly config: ConfigService,
  ) {
    this.cfg = this.config.get("modules.web-monitor") || {};
  }

  async getAverageErrorList(query: Record<string, unknown>) {
    const {
      appId,
      beginTime,
      endTime,
      type = "",
      realTime,
      resourceUrl,
      pageSize = this.cfg.pageSize,
      uid,
      phone,
    } = query;
    const pageNo = Number(query.pageNo || 1);
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (resourceUrl) {
      wheres.push(`ilike(resourceUrl, {resourceUrl:String})`);
      queryParams.resourceUrl = `%${resourceUrl}%`;
    }
    if (phone) {
      wheres.push(`ilike(phone, {phone:String})`);
      queryParams.phone = `%${phone}%`;
    }
    if (uid) {
      wheres.push(`ilike(uid, {uid:String})`);
      queryParams.uid = `%${uid}%`;
    }
    if (beginTime) {
      wheres.push(`createTime >= toDateTime({beginTime:String})`);
      queryParams.beginTime = beginTime;
    }
    if (endTime) {
      wheres.push(`createTime <= toDateTime({endTime:String})`);
      queryParams.endTime = endTime;
    }
    if (type) {
      wheres.push(`type IN ({typeArr:Array(String)})`);
      queryParams.typeArr = String(type).split("|");
    }
    const where = wheres.length ? wheres.join(" AND ") : undefined;
    const model = await this.ch.WebError(String(appId));

    if (String(realTime) === "1") {
      const total = await model.find({ where, select: "count() as total", queryParams });
      const list = await model.find({
        where,
        select: "*",
        limit: Number(pageSize),
        skip: (pageNo - 1) * Number(pageSize),
        orderBy: "createTime DESC",
        queryParams,
      });
      list.forEach((item: Record<string, unknown>) => (item._id = { ...item }));
      return { dataList: list, totalNum: total?.[0]?.total || 0, pageNo };
    }

    let groupBy = "";
    if (type === "script") groupBy = "resourceUrl,name,type";
    else if (type === "resource") groupBy = "resourceUrl,type";
    else if (type === "ajax|fetch") groupBy = "resourceUrl,status,type";
    else if (type === "bussiness-ajax|bussiness-fetch") groupBy = "resourceUrl,status,type";
    else if (type === "log") groupBy = "resourceUrl,type";

    const countQuery = model.find([{ where, groupBy, select: "COUNT()", queryParams }, { select: "count() as total" }]);
    const listQuery = model.find({
      where,
      select: `${groupBy}, MAX(createTime) AS lastCreateTime,COUNT() AS count,COUNT(DISTINCT markUser) AS userNum,groupArray(msg)[1] AS lastMsg`,
      groupBy,
      limit: Number(pageSize),
      skip: (pageNo - 1) * Number(pageSize),
      orderBy: "count DESC",
      queryParams,
    });
    const [count, list] = await Promise.all([countQuery, listQuery]);
    list.forEach((item: Record<string, unknown>) => (item._id = { ...item }));
    return { dataList: list, totalNum: count?.[0]?.total || 0, pageNo };
  }

  async getOneErrorList(query: Record<string, unknown>) {
    const { appId, url, name = "", status = "", type = "", beginTime, endTime, phone = "", uid = "" } = query;
    const pageNo = Number(query.pageNo || 1);
    const pageSize = Number(query.pageSize || this.cfg.pageSize);
    const wheres: string[] = [];
    const queryParams: Record<string, unknown> = {};
    if (url) {
      wheres.push(`resourceUrl = {url:String}`);
      queryParams.url = url;
    }
    if (name) {
      wheres.push(`name = {name:String}`);
      queryParams.name = name;
    }
    if (status) {
      wheres.push(`status = {status:String}`);
      queryParams.status = status;
    }
    if (type) {
      wheres.push(`type = {type:String}`);
      queryParams.type = type;
    }
    if (phone) {
      wheres.push(`ilike(phone, {phone:String})`);
      queryParams.phone = `%${phone}%`;
    }
    if (uid) {
      wheres.push(`ilike(uid, {uid:String})`);
      queryParams.uid = `%${uid}%`;
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
    const model = await this.ch.WebError(String(appId));
    const countQuery = model.find({ where, select: "count() as total", queryParams });
    const listQuery = model.find({
      where,
      select: "*",
      limit: pageSize,
      skip: (pageNo - 1) * pageSize,
      orderBy: "createTime DESC",
      queryParams,
    });
    const groupBy = "resourceUrl";
    const otherQuery = model.find({
      where,
      select: `${groupBy},MIN(createTime) AS first,MAX(createTime) AS last,COUNT() AS count,COUNT(DISTINCT markUser) AS userNum`,
      limit: pageSize,
      groupBy,
      queryParams,
    });
    const [count, list, other] = await Promise.all([countQuery, listQuery, otherQuery]);
    list.forEach((item: Record<string, unknown>) => (item._id = { ...item }));
    let userNum = 0,
      first = "",
      last = "";
    if (other.length > 0) {
      userNum = Number(other[0].userNum) || 0;
      first = String(other[0].first ?? "");
      last = String(other[0].last ?? "");
    }
    return { dataList: list, totalNum: count?.[0]?.total || 0, pageNo, first, last, userNum };
  }

  async getMarkUserErrorListCH(appId: string, opts: { markUser?: string; beginTime?: string; endTime?: string }) {
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
    const model = await this.ch.WebError(appId);
    const list = await model.find({ where, select: "*", orderBy: "createTime ASC", queryParams });
    return { list };
  }
}
