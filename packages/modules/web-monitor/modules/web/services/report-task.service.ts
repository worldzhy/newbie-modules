import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "@modules/redis/redis.service";
import { SiteService } from "@modules/web-monitor/modules/site/site.service";
import { MonitorClickhouseService } from "../../../models/clickhouse/monitor-clickhouse.service";
import { MonitorModelsService } from "../../../models/mongo/monitor-models.service";
import { SystemDocument } from "../../../models/mongo/system.schema";
import { func } from "../../../shared/utils";
import { UAParser } from "ua-parser-js";
import { RedisKeys, RedisKeyPrefix, ReportType } from "../../../models/enum";

/**
 * Plain-row accumulators for one drain tick. ClickHouse destinations were
 * already batched per app; Mongo destinations now batch the same way so a
 * tick costs O(apps) writes instead of O(reports) single-document saves.
 */
interface DrainBuckets {
  appAjaxs: Record<string, Record<string, unknown>[]>;
  appErrors: Record<string, Record<string, unknown>[]>;
  appPages: Record<string, Record<string, unknown>[]>;
  appEnvironments: Record<string, Record<string, unknown>[]>;
  appResources: Record<string, Record<string, unknown>[]>;
  appCustoms: Record<string, Record<string, unknown>[]>;
  sdkErrors: Record<string, unknown>[];
}

/**
 * Normalized report item produced by handleWebData from one raw SDK payload.
 * Fields not present in the payload stay undefined; numeric performance
 * entries and resource/error list items keep their raw per-key values.
 */
interface WebReportItem {
  appId: string;
  createTime: Date;
  userAgent: string;
  ip?: string;
  markPage: string;
  markUser: string;
  markUv: string;
  markDevice: string;
  url: string;
  p?: unknown;
  uid?: unknown;
  isFirstIn: boolean;
  errorList?: Record<string, unknown>[];
  resourceList?: Record<string, unknown>[];
  customs?: Record<string, unknown>[];
  preUrl?: string;
  performance?: Record<string, unknown>;
  screenWidth?: unknown;
  screenHeight?: unknown;
  // SDK-error payloads only (never populated by handleWebData today).
  sdkVersion?: unknown;
  name?: unknown;
  msg?: unknown;
  stack?: unknown;
  // Geo fields: not populated by handleWebData today, kept for row shape parity.
  county?: unknown;
  province?: unknown;
}

@Injectable()
export class WebReportTaskService {
  private cfg: Record<string, unknown>;
  private readonly logger = new Logger(WebReportTaskService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly site: SiteService,
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService,
  ) {
    this.cfg = this.config.get("modules.web-monitor") || {};
  }

  private pushRow(bucket: Record<string, Record<string, unknown>[]>, appId: string, row: Record<string, unknown>) {
    const rows = bucket[appId];
    if (rows) rows.push(row);
    else bucket[appId] = [row];
  }

  private async collectQueueItem(raw: string, buckets: DrainBuckets) {
    let query: Record<string, unknown>;
    try {
      query = JSON.parse(raw);
    } catch {
      return;
    }
    const querytype = query.type || ReportType.PagePerf;
    const item = this.handleWebData(query);
    if (query.type === ReportType.SdkError) {
      this.collectSdkError(item, buckets.sdkErrors);
      return;
    }
    if (!item.appId) return;
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

  private collectPages(item: WebReportItem, slowPageTime = 5, appPages: Record<string, Record<string, unknown>[]>) {
    const performance = item.performance || {};
    let newName = "";
    try {
      const u = new URL(func.urlHelper(item.url));
      newName = `${u.protocol}//${u.host}${u.pathname}${u.hash ? u.hash : ""}`;
    } catch {
      newName = item.url || "";
    }
    slowPageTime = slowPageTime * 1000;
    const speedType = Number(performance.lodt) >= slowPageTime ? 2 : 1;
    const page: Record<string, unknown> = {
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

  private collectCustoms(data: WebReportItem, appCustoms: Record<string, Record<string, unknown>[]>) {
    if (!data.customs || !data.customs.length) return;
    for (const item of data.customs) {
      const customFilter = item.customFilter;
      if (func.isObject(customFilter)) {
        Object.keys(customFilter).forEach((key) => {
          if (typeof customFilter[key] === "number") customFilter[key] = String(customFilter[key]);
        });
      }
      const custom: Record<string, unknown> = {
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

  private collectResource(
    data: WebReportItem,
    item: Record<string, unknown>,
    system: SystemDocument,
    appResources: Record<string, Record<string, unknown>[]>,
  ) {
    let slowTime = 2;
    let speedType = 1;
    let duration = Math.floor(Math.abs(Number(item.duration) || 0));
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
      newName = typeof item.name === "string" ? item.name : "";
    }
    const resource: Record<string, unknown> = {
      appId: data.appId,
      createTime: item.requestTime ? func.toDate(item.requestTime) : data.createTime,
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

  private async collectEnvironment(data: WebReportItem, appEnvironments: Record<string, Record<string, unknown>[]>) {
    const ip = data.ip;
    if (!ip) return;
    const ipParts = ip.split(".");
    const copyip = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
    let datas: Record<string, unknown> | null = null;
    try {
      const s = await this.redis.getClient().get(`${RedisKeyPrefix.IP_GEO_CACHE}${copyip}`);
      if (s) datas = JSON.parse(s);
    } catch {
      datas = null;
    }
    const environment: Record<string, unknown> = {
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

  private collectSdkError(data: WebReportItem, sdkErrors: Record<string, unknown>[]) {
    const sdkErr: Record<string, unknown> = {
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

  private setUser(obj: Record<string, unknown>, data: WebReportItem) {
    if (data.uid) obj.uid = String(data.uid);
    if (data.p) obj.phone = func.decryptPhone(data.p);
  }

  async saveWebReportDatasForRedis() {
    const consumption = func.isObject(this.cfg.redis_consumption) ? this.cfg.redis_consumption : {};
    const count = Number(consumption.thread_web) || 1000;
    const buckets: DrainBuckets = {
      appAjaxs: {},
      appErrors: {},
      appPages: {},
      appEnvironments: {},
      appResources: {},
      appCustoms: {},
      sdkErrors: [],
    };
    // One round trip for the whole batch instead of one RPOP per report
    // (RPOP key count, Redis >= 6.2).
    const raws = (await this.redis.getClient().rpop(RedisKeys.WEB_REPORT_DATAS, count)) || [];
    for (const raw of raws) {
      try {
        await this.collectQueueItem(raw, buckets);
      } catch (e: unknown) {
        // A single malformed/poisoned item must not abort the rest of the batch.
        this.logger.error("web report item processing failed", e instanceof Error ? e.message : String(e));
      }
    }
    await this.flushBuckets(buckets);
  }

  private async flushBuckets(buckets: DrainBuckets) {
    const flush = async (label: string, write: () => Promise<unknown>) => {
      try {
        await write();
      } catch (e: unknown) {
        // One failing destination must not suppress the remaining flushes.
        this.logger.error(`web report flush failed (${label})`, e instanceof Error ? e.message : String(e));
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

  private handleWebData(query: Record<string, unknown>): WebReportItem {
    const str = (value: unknown, fallback = "") => (typeof value === "string" && value ? value : fallback);
    const item: WebReportItem = {
      appId: str(query.appId),
      createTime: func.toDate(query.time),
      userAgent: str(query.userAgent),
      ip: str(query.ip) || undefined,
      markPage: str(query.markPage, func.randomString()),
      markUser: str(query.markUser),
      markUv: str(query.markUv),
      markDevice: str(query.markDevice),
      url: str(query.url),
      p: query.p,
      uid: query.uid,
      isFirstIn: Boolean(query.isFirstIn),
      errorList: Array.isArray(query.errorList) ? query.errorList : undefined,
      resourceList: Array.isArray(query.resourceList) ? query.resourceList : undefined,
      customs: Array.isArray(query.customs) ? query.customs : undefined,
    };
    if (query.isFirstIn) {
      item.preUrl = str(query.preUrl);
      item.performance = func.isObject(query.performance) ? query.performance : undefined;
      item.screenWidth = query.screenWidth;
      item.screenHeight = query.screenHeight;
    }
    return item;
  }

  private forEachResources(data: WebReportItem, system: SystemDocument, buckets: DrainBuckets) {
    if (!data.resourceList || !data.resourceList.length) return;
    data.resourceList.forEach((item) => {
      if (item.type === "xmlhttprequest" || item.type === "fetchrequest" || item.type === "fetch") {
        this.saveAjaxs(data, item, buckets.appAjaxs);
      } else {
        this.collectResource(data, item, system, buckets.appResources);
      }
    });
  }

  private saveAjaxs(
    data: WebReportItem,
    item: Record<string, unknown>,
    appAjaxs: Record<string, Record<string, unknown>[]>,
  ) {
    let newName = "";
    try {
      const newurl = new URL(func.urlHelper(item.name));
      newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
    } catch {
      newName = typeof item.name === "string" ? item.name : "";
    }
    const duration = Math.floor(Math.abs(Number(item.duration) || 0));

    const _ajax: Record<string, unknown> = {
      appId: data.appId,
      createTime: item.requestTime ? func.toDate(item.requestTime) : data.createTime,
    };
    _ajax.url = newName || "";
    _ajax.fullUrl = item.name || "";
    _ajax.method = item.method || "";
    _ajax.duration = duration;
    _ajax.bodySize = item.bodySize ? Number(item.bodySize) : 0;
    _ajax.callUrl = data.url || "";
    if (item.options) _ajax.options = func.filterKeyWord(item.options);
    try {
      const newurl = new URL(String(item.name));
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

  private collectErrors(data: WebReportItem, appErrors: Record<string, Record<string, unknown>[]>) {
    if (!data.errorList || !data.errorList.length) return;
    for (const item of data.errorList) {
      const rawItemData: unknown = item?.data;
      const itemData = func.isObject(rawItemData) ? rawItemData : {};
      const resourceUrl = typeof itemData.resourceUrl === "string" ? itemData.resourceUrl : "";
      if (resourceUrl.startsWith("data://image")) continue;

      let newName = "";
      try {
        const newurl = new URL(func.urlHelper(resourceUrl));
        newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
      } catch {
        newName = resourceUrl;
      }

      const errors: Record<string, unknown> = {};
      errors.resourceUrl = newName || "";
      errors.fullUrl = resourceUrl;
      errors.url = data.url || "";
      errors.createTime = item.createTime ? func.toDate(item.createTime) : data.createTime;

      if (typeof item.msg === "object") errors.msg = JSON.stringify(item.msg);
      else if (typeof item.msg === "string") errors.msg = item.msg;
      else errors.msg = item.msg || "";

      errors.type = item.type || "";
      errors.name = item.name || "";
      errors.api = item.api || "";
      if (Array.isArray(item.stack)) errors.stack = JSON.stringify(item.stack);
      errors.target = itemData.target || "";
      errors.status = itemData.status ? String(itemData.status) : "";
      errors.col = itemData.col ? String(itemData.col) : "";
      errors.line = itemData.line ? String(itemData.line) : "";
      errors.method = item.method || "";

      try {
        const u = new URL(resourceUrl);
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
