import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "../../../models/redis/redis.service";
import { SiteService } from "../../../modules/site/site.service";
import { MonitorClickhouseService } from "../../../models/clickhouse/monitor-clickhouse.service";
import { MonitorModelsService } from "../../../models/mongo/monitor-models.service";
import { func } from "../../../shared/utils";
import { UAParser } from "ua-parser-js";
import { RedisKeys, ReportType } from "../../../models/enum";

/**
 * Plain-row accumulators for one drain tick. ClickHouse destinations were
 * already batched per app; Mongo destinations now batch the same way so a
 * tick costs O(apps) writes instead of O(reports) single-document saves.
 */
interface DrainBuckets {
  appAjaxs: Record<string, any[]>;
  appErrors: Record<string, any[]>;
  appPages: Record<string, any[]>;
  appEnvironments: Record<string, any[]>;
  appResources: Record<string, any[]>;
  appCustoms: Record<string, any[]>;
  sdkErrors: any[];
}

@Injectable()
export class WebReportTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly site: SiteService,
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService,
  ) {
    this.cfg = this.config.get("modules.web-monitor");
  }

  private pushRow(bucket: Record<string, any[]>, appId: string, row: any) {
    const rows = bucket[appId];
    if (rows) rows.push(row);
    else bucket[appId] = [row];
  }

  private async collectQueueItem(raw: string, buckets: DrainBuckets) {
    let query: any;
    try {
      query = JSON.parse(raw);
    } catch {
      return;
    }
    const querytype = query.type || ReportType.PagePerf;
    const item = await this.handleWebData(query);
    if (query.type === ReportType.SdkError) {
      this.collectSdkError(item, buckets.sdkErrors);
      return;
    }
    const system = await this.site.getSiteForAppId(item.appId);
    if (!system) return;
    // All anomaly-relevant data is always persisted; thresholds define what an
    // anomaly is, collection switches are intentionally not supported.
    if (querytype === ReportType.PagePerf) this.collectPages(item, system.slowPageTime, buckets.appPages);
    this.forEachResources(item, system, buckets);
    this.collectErrors(item, buckets.appErrors);
    if (querytype === ReportType.PagePerf) await this.collectEnvironment(item, buckets.appEnvironments);
    this.collectCustoms(item, buckets.appCustoms);
  }

  private collectPages(item: any, slowPageTime = 5, appPages: Record<string, any[]>) {
    const performance = item.performance || {};
    let newName = "";
    try {
      const u = new URL(func.urlHelper(item.url));
      newName = `${u.protocol}//${u.host}${u.pathname}${u.hash ? u.hash : ""}`;
    } catch {
      newName = item.url || "";
    }
    slowPageTime = slowPageTime * 1000;
    const speedType = performance.lodt >= slowPageTime ? 2 : 1;
    const page: Record<string, any> = {
      appId: item.appId,
      createTime: item.createTime,
      url: newName,
      fullUrl: item.url,
      preUrl: item.preUrl,
      speedType,
      isFirstIn: item.isFirstIn,
      markPage: item.markPage,
      markUser: item.markUser,
      screenWidth: item.screenWidth,
      screenHeight: item.screenHeight,
    };
    if (performance.wit !== undefined) page.whiteTime = performance.wit;
    if (performance.dnst !== undefined) page.dnsTime = performance.dnst;
    if (performance.lodt !== undefined) page.loadTime = performance.lodt;
    if (performance.reqt !== undefined) page.requestTime = performance.reqt;
    if (performance.tcpt !== undefined) page.tcpTime = performance.tcpt;
    if (performance.andt !== undefined) page.analysisDomTime = performance.andt;
    this.pushRow(appPages, item.appId, page);
  }

  private collectCustoms(data: any, appCustoms: Record<string, any[]>) {
    if (!data.customs || !data.customs.length) return;
    for (const item of data.customs) {
      if (item.customFilter && Object.prototype.toString.apply(item.customFilter) === "[object Object]") {
        Object.keys(item.customFilter).forEach((key) => {
          if (typeof item.customFilter[key] === "number") item.customFilter[key] = String(item.customFilter[key]);
        });
      }
      const custom: Record<string, any> = {
        appId: data.appId,
        createTime: data.createTime,
        markPage: data.markPage,
        markUser: data.markUser,
        path: "",
        customName: item.customName,
        customContent: item.customContent,
        customFilter: item.customFilter,
      };
      this.setUser(custom, data);
      this.pushRow(appCustoms, data.appId, custom);
    }
  }

  private collectResource(data: any, item: any, system: any, appResources: Record<string, any[]>) {
    let slowTime = 2;
    let speedType = 1;
    let duration = Math.floor(Math.abs(item.duration || 0));
    if (duration > 60000) duration = 60000;
    if (item.type === "link" || item.type === "css") slowTime = (system.slowCssTime || 2) * 1000;
    else if (item.type === "script") slowTime = (system.slowJsTime || 2) * 1000;
    else if (item.type === "img") slowTime = (system.slowImgTime || 2) * 1000;
    else slowTime = 2000;
    speedType = duration >= slowTime ? 2 : 1;
    if (duration < slowTime) return;
    let newName = "";
    try {
      const u = new URL(func.urlHelper(item.name));
      newName = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      newName = item.name || "";
    }
    const resource: Record<string, any> = {
      appId: data.appId,
      createTime: item.requestTime ? new Date(item.requestTime) : data.createTime,
      url: data.url,
      fullUrl: item.name,
      speedType,
      name: newName,
      method: item.method,
      type: item.type,
      duration,
      bodySize: item.bodySize ? Number(item.bodySize) : 0,
      nextHopProtocol: item.nextHopProtocol,
      markPage: data.markPage,
      markUser: data.markUser,
    };
    this.setUser(resource, data);
    this.pushRow(appResources, data.appId, resource);
  }

  private async collectEnvironment(data: any, appEnvironments: Record<string, any[]>) {
    const ip = data.ip;
    if (!ip) return;
    let copyip = ip.split(".");
    copyip = `${copyip[0]}.${copyip[1]}.${copyip[2]}`;
    let datas: any = null;
    try {
      const s = await this.redis.get(copyip);
      if (s) datas = JSON.parse(s);
    } catch {
      datas = null;
    }
    const environment: Record<string, any> = {
      appId: data.appId,
      createTime: data.createTime,
      url: data.url,
      markPage: data.markPage,
      markUser: data.markUser,
      markUv: data.markUv,
    };
    if (data.markDevice) environment.markDevice = data.markDevice;
    this.setUser(environment, data);

    const parser = new UAParser();
    parser.setUA(data.userAgent);
    const result = parser.getResult();
    environment.browser = result?.browser?.name || "";
    environment.browserVersion = result?.browser?.version || "";
    environment.system = result?.os?.name || "";
    environment.systemVersion = result?.os?.version || "";

    environment.ip = data.ip;
    environment.county = data.county;
    environment.province = data.province;
    if (datas) {
      environment.province = datas.province;
      environment.city = datas.city;
    }
    this.pushRow(appEnvironments, data.appId, environment);
  }

  private collectSdkError(data: any, sdkErrors: any[]) {
    const sdkErr: Record<string, any> = {
      appId: data.appId,
      createTime: data.createTime,
      markUser: data.markUser,
      sdkVersion: data.sdkVersion,
      name: data.name,
      msg: data.msg,
      stack: data.stack,
    };
    this.setUser(sdkErr, data);

    const parser = new UAParser();
    parser.setUA(data.userAgent);
    const result = parser.getResult();
    sdkErr.browser = result?.browser?.name || "";
    sdkErr.browserVersion = result?.browser?.version || "";
    sdkErr.system = result?.os?.name || "";
    sdkErr.systemVersion = result?.os?.version || "";

    sdkErrors.push(sdkErr);
  }

  private setUser(obj: any, data: any) {
    if (data.uid) obj.uid = String(data.uid);
    if (data.p) obj.phone = func.decryptPhone(data.p);
  }

  async saveWebReportDatasForRedis() {
    const count = this.cfg.redis_consumption?.thread_web || 1000;
    const buckets: DrainBuckets = {
      appAjaxs: {},
      appErrors: {},
      appPages: {},
      appEnvironments: {},
      appResources: {},
      appCustoms: {},
      sdkErrors: [],
    };
    // One round trip for the whole batch instead of one RPOP per report.
    const raws = await this.redis.rpopBatch(RedisKeys.WEB_REPORT_DATAS, count);
    for (const raw of raws) {
      try {
        await this.collectQueueItem(raw, buckets);
      } catch (e: any) {
        // A single malformed/poisoned item must not abort the rest of the batch.
        console.error("web report item processing failed", e?.message || e);
      }
    }
    await this.flushBuckets(buckets);
  }

  private async flushBuckets(buckets: DrainBuckets) {
    const flush = async (label: string, write: () => Promise<unknown>) => {
      try {
        await write();
      } catch (e: any) {
        // One failing destination must not suppress the remaining flushes.
        console.error(`web report flush failed (${label})`, e?.message || e);
      }
    };
    for (const appId of Object.keys(buckets.appAjaxs)) {
      const rows = buckets.appAjaxs[appId];
      if (rows.length) await flush(`ajax:${appId}`, async () => (await this.ch.WebAjax(appId)).insertMany(rows));
    }
    for (const appId of Object.keys(buckets.appErrors)) {
      const rows = buckets.appErrors[appId];
      if (rows.length) await flush(`error:${appId}`, async () => (await this.ch.WebError(appId)).insertMany(rows));
    }
    if (buckets.sdkErrors.length) {
      await flush("sdk-error", async () => (await this.ch.WebSdkError()).insertMany(buckets.sdkErrors));
    }
    for (const appId of Object.keys(buckets.appPages)) {
      const rows = buckets.appPages[appId];
      if (rows.length) await flush(`page:${appId}`, () => this.models.WebPage(appId).insertMany(rows));
    }
    for (const appId of Object.keys(buckets.appEnvironments)) {
      const rows = buckets.appEnvironments[appId];
      if (rows.length) await flush(`environment:${appId}`, () => this.models.WebEnvironment(appId).insertMany(rows));
    }
    for (const appId of Object.keys(buckets.appResources)) {
      const rows = buckets.appResources[appId];
      if (rows.length) await flush(`resource:${appId}`, () => this.models.WebResource(appId).insertMany(rows));
    }
    for (const appId of Object.keys(buckets.appCustoms)) {
      const rows = buckets.appCustoms[appId];
      if (rows.length) await flush(`custom:${appId}`, () => this.models.WebCustom(appId).insertMany(rows));
    }
  }

  private async handleWebData(query: any) {
    const type = query.type || ReportType.PagePerf;
    let item: any = {
      appId: query.appId,
      createTime: new Date(query.time),
      userAgent: query.userAgent,
      ip: query.ip,
      markPage: query.markPage || func.randomString(),
      markUser: query.markUser || "",
      markUv: query.markUv || "",
      markDevice: query.markDevice || "",
      url: query.url,
      p: query.p,
      uid: query.uid,
    };
    item = Object.assign(item, {
      isFirstIn: query.isFirstIn || false,
      errorList: query.errorList,
      resourceList: query.resourceList,
      customs: query.customs,
    });
    if (query.isFirstIn) {
      item = Object.assign(item, {
        preUrl: query.preUrl,
        performance: query.performance,
        screenWidth: query.screenWidth,
        screenHeight: query.screenHeight,
      });
    }
    return item;
  }

  private forEachResources(data: any, system: any, buckets: DrainBuckets) {
    if (!data.resourceList || !data.resourceList.length) return;
    data.resourceList.forEach((item: any) => {
      if (item.type === "xmlhttprequest" || item.type === "fetchrequest" || item.type === "fetch") {
        this.saveAjaxs(data, item, buckets.appAjaxs);
      } else {
        this.collectResource(data, item, system, buckets.appResources);
      }
    });
  }

  private saveAjaxs(data: any, item: any, appAjaxs: Record<string, any[]>) {
    let newName = "";
    try {
      const newurl = new URL(func.urlHelper(item.name));
      newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
    } catch {
      newName = item.name || "";
    }
    const duration = Math.floor(Math.abs(item.duration || 0));

    const _ajax: Record<string, any> = {
      appId: data.appId,
      createTime: item.requestTime ? new Date(item.requestTime) : data.createTime,
    };
    _ajax.url = newName || "";
    _ajax.fullUrl = item.name || "";
    _ajax.method = item.method || "";
    _ajax.duration = duration;
    _ajax.bodySize = item.bodySize ? Number(item.bodySize) : 0;
    _ajax.callUrl = data.url || "";
    if (item.options) _ajax.options = func.filterKeyWord(item.options);
    try {
      const newurl = new URL(item.name);
      if (newurl.searchParams.toString()) _ajax.query = newurl.searchParams.toString();
    } catch {
      // Expected failure: the URL may be malformed — skip query extraction.
    }
    if (item.traceId) _ajax.traceId = item.traceId;
    if (data.uid) _ajax.uid = String(data.uid);
    if (data.p) _ajax.phone = func.decryptPhone(data.p);
    _ajax.markPage = data.markPage || "";
    _ajax.markUser = data.markUser || "";

    this.pushRow(appAjaxs, data.appId, _ajax);
  }

  private collectErrors(data: any, appErrors: Record<string, any[]>) {
    if (!data.errorList || !data.errorList.length) return;
    for (const item of data.errorList) {
      if (item?.data?.resourceUrl && item.data.resourceUrl.startsWith("data://image")) continue;

      let newName = "";
      try {
        const newurl = new URL(func.urlHelper(item?.data?.resourceUrl || ""));
        newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
      } catch {
        newName = item?.data?.resourceUrl || "";
      }

      const errors: Record<string, any> = {};
      errors.resourceUrl = newName || "";
      errors.fullUrl = item?.data?.resourceUrl || "";
      errors.url = data.url || "";
      errors.createTime = item.createTime ? new Date(item.createTime) : data.createTime;

      if (typeof item.msg === "object") errors.msg = JSON.stringify(item.msg);
      else if (typeof item.msg === "string") errors.msg = item.msg;
      else errors.msg = item.msg || "";

      errors.type = item.type || "";
      errors.name = item.name || "";
      errors.api = item.api || "";
      if (Array.isArray(item.stack)) errors.stack = JSON.stringify(item.stack);
      errors.target = item?.data?.target || "";
      errors.status = item?.data?.status ? String(item.data.status) : "";
      errors.col = item?.data?.col ? String(item.data.col) : "";
      errors.line = item?.data?.line ? String(item.data.line) : "";
      errors.method = item.method || "";

      try {
        const u = new URL(item?.data?.resourceUrl || "");
        if (u.searchParams.toString()) errors.query = u.searchParams.toString();
      } catch {
        // Expected failure: the URL may be malformed — skip query extraction.
      }
      if (item.options) errors.options = func.filterKeyWord(item.options);
      if (item.traceId) errors.traceId = item.traceId;

      errors.markPage = data.markPage || "";
      errors.markUser = data.markUser || "";
      if (data.uid) errors.uid = String(data.uid);
      if (data.p) errors.phone = func.decryptPhone(data.p);

      this.pushRow(appErrors, data.appId, errors);
    }
  }
}
