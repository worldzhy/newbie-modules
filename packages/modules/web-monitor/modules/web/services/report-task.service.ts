import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "@modules/redis/redis.service";
import { SiteService } from "@modules/web-monitor/modules/site/site.service";
import { WebMonitorClickHouseService } from "../../../models/clickhouse/web-monitor-clickhouse.service";
import { WebMonitorModelsService } from "../../../models/mongo/web-monitor-models.service";
import { SystemDocument } from "../../../models/mongo/system.schema";
import { func } from "../../../shared/utils";
import { WEB_MONITOR_CONFIG } from "../../../shared/web-monitor-config";
import { UAParser } from "ua-parser-js";
import { RedisKeys, RedisKeyPrefix, ReportType } from "../../../models/enum";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

// A report that keeps failing to flush is retried at most this many times
// before it is parked in the dead-letter list (R15-01/R9-07).
const MAX_REPORT_ATTEMPTS = 3;
const MAX_DEAD_LETTER_ENTRIES = 1000;
// Upper bound for client-reported durations. ClickHouse `UInt32` rejects values
// above 2^32-1 with Code 27, which would fail the whole ingest batch and poison
// the queue (R20-04). Resource rows have always been clamped to 60s; ajax rows
// share the same ceiling so an absurd `duration` cannot reach the writer.
const MAX_DURATION_MS = 60_000;

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
  appKey: string;
  createTime: Date;
  userAgent: string;
  ip?: string;
  markPage: string;
  markUser: string;
  markUv: string;
  markDevice: string;
  url: string;
  p?: string;
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
  private readonly logger = new Logger(WebReportTaskService.name);
  constructor(
    private readonly redis: RedisService,
    private readonly site: SiteService,
    private readonly models: WebMonitorModelsService,
    private readonly ch: WebMonitorClickHouseService,
  ) {}

  private pushRow(bucket: Record<string, Record<string, unknown>[]>, appKey: string, row: Record<string, unknown>) {
    const rows = bucket[appKey];
    if (rows) rows.push(row);
    else bucket[appKey] = [row];
  }

  private async collectQueueItem(raw: string, buckets: DrainBuckets): Promise<string | null> {
    let query: Record<string, unknown>;
    try {
      query = JSON.parse(raw);
    } catch {
      return null;
    }
    const querytype = query.type || ReportType.PagePerf;
    const item = this.handleWebData(query);
    if (query.type === ReportType.SdkError) {
      this.collectSdkError(item, buckets.sdkErrors);
      return item.appKey || null;
    }
    if (!item.appKey) {
      this.logger.warn("web report item dropped: missing appKey");
      return null;
    }
    const system = await this.site.getSiteForAppId(item.appKey);
    if (!system) {
      this.logger.warn(`web report item dropped: site not found for appKey=${item.appKey}`);
      return null;
    }
    // All anomaly-relevant data is always persisted; thresholds define what an
    // anomaly is, collection switches are intentionally not supported.
    if (querytype === ReportType.PagePerf) this.collectPages(item, system.slowPageTime, buckets.appPages);
    this.forEachResources(item, system, buckets);
    this.collectErrors(item, buckets.appErrors);
    if (querytype === ReportType.PagePerf) await this.collectEnvironment(item, buckets.appEnvironments);
    this.collectCustoms(item, buckets.appCustoms);
    return item.appKey;
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
      appKey: item.appKey,
      createTime: item.createTime,
      url: newName,
      fullUrl: item.url,
      preUrl: item.preUrl,
      speedType,
      isFirstIn: item.isFirstIn,
      markPage: item.markPage,
      markUser: item.markUser,
    };
    // Client-supplied numeric fields are normalized to skip writes for invalid
    // values so Mongo $avg correctly ignores missing keys instead of averaging
    // in a poisoned 0. See R12-01.
    const sw = func.toNumberOrUndefined(item.screenWidth);
    if (sw !== undefined) page.screenWidth = sw;
    const sh = func.toNumberOrUndefined(item.screenHeight);
    if (sh !== undefined) page.screenHeight = sh;
    const wt = func.toNumberOrUndefined(performance.wit);
    if (wt !== undefined) page.whiteTime = wt;
    const dns = func.toNumberOrUndefined(performance.dnst);
    if (dns !== undefined) page.dnsTime = dns;
    const load = func.toNumberOrUndefined(performance.lodt);
    if (load !== undefined) page.loadTime = load;
    const req = func.toNumberOrUndefined(performance.reqt);
    if (req !== undefined) page.requestTime = req;
    const tcp = func.toNumberOrUndefined(performance.tcpt);
    if (tcp !== undefined) page.tcpTime = tcp;
    const adom = func.toNumberOrUndefined(performance.andt);
    if (adom !== undefined) page.analysisDomTime = adom;
    this.pushRow(appPages, item.appKey, page);
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
        appKey: data.appKey,
        createTime: data.createTime,
        markPage: data.markPage,
        markUser: data.markUser,
        path: "",
      };
      // String-declared columns must never receive a raw client object:
      // Mongoose turns `{}` into a CastError and the whole app batch fails.
      // Normalize every string column at the row boundary (R15-01).
      const customName = func.toStringOrUndefined(item.customName);
      if (customName !== undefined) custom.customName = customName;
      custom.customFilter = item.customFilter;
      // customContent is declared string; JSON-stringify object values and skip
      // anything that isn't string-or-object so Mongoose doesn't receive a type
      // it can't cast. See R12-01.
      const cc = func.toStringOrUndefined(item.customContent);
      if (cc !== undefined) custom.customContent = cc;
      this.setUser(custom, data);
      this.pushRow(appCustoms, data.appKey, custom);
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
    const rawDuration = func.toNumberOrUndefined(item.duration);
    // Invalid duration falls back to 0 for the speed-type threshold only — the
    // actual row write skips the field so Mongo $avg doesn't average in 0.
    let duration = Math.floor(Math.abs((rawDuration ?? 0) as number));
    if (duration > MAX_DURATION_MS) duration = MAX_DURATION_MS;
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
      appKey: data.appKey,
      createTime: item.requestTime ? func.toDateOrNow(item.requestTime) : data.createTime,
      url: data.url,
      speedType,
      name: newName,
    };
    // String-declared columns: coerce client values so an object can never
    // produce a Mongoose CastError that fails the whole app batch (R15-01).
    const fullUrl = func.toStringOrUndefined(item.name);
    if (fullUrl !== undefined) resource.fullUrl = fullUrl;
    const method = func.toStringOrUndefined(item.method);
    if (method !== undefined) resource.method = method;
    const type = func.toStringOrUndefined(item.type);
    if (type !== undefined) resource.type = type;
    const nextHopProtocol = func.toStringOrUndefined(item.nextHopProtocol);
    if (nextHopProtocol !== undefined) resource.nextHopProtocol = nextHopProtocol;
    // duration: always write when the row passes the slow filter (the
    // threshold already normalized it); don't skip here — rawDuration is
    // already guarded by the early-return above which fires on short durations.
    resource.duration = duration;
    // bodySize: skip write for values that don't parse as finite numbers so
    // Mongo $avg ignores missing keys instead of averaging in a poisoned 0.
    const bs = func.toNumberOrUndefined(item.bodySize);
    if (bs !== undefined) resource.bodySize = bs;
    resource.markPage = data.markPage;
    resource.markUser = data.markUser;
    this.setUser(resource, data);
    this.pushRow(appResources, data.appKey, resource);
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
      appKey: data.appKey,
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
    this.pushRow(appEnvironments, data.appKey, environment);
  }

  private collectSdkError(data: WebReportItem, sdkErrors: Record<string, unknown>[]) {
    const sdkErr: Record<string, unknown> = {
      appKey: data.appKey,
      createTime: data.createTime,
      markUser: data.markUser,
      sdkVersion: func.toStringOrUndefined(data.sdkVersion),
      name: func.toStringOrUndefined(data.name),
      msg: func.toStringOrUndefined(data.msg),
      stack: func.toStringOrUndefined(data.stack),
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
    const consumption = WEB_MONITOR_CONFIG.redis_consumption;
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
    const rawsByApp: Record<string, string[]> = {};
    let failedItems = 0;
    for (const raw of raws) {
      try {
        const appKey = await this.collectQueueItem(raw, buckets);
        if (appKey) (rawsByApp[appKey] ||= []).push(raw);
      } catch (e: unknown) {
        // A single malformed/poisoned item must not abort the rest of the batch.
        // Count them so silent drops are visible in the tick summary (R9-04).
        failedItems += 1;
        this.logger.error("web report item processing failed", getErrorMessage(e));
      }
    }
    const failedAppIds = await this.flushBuckets(buckets);
    if (failedAppIds.size) {
      // Re-queue the raw payloads of every app whose flush failed so the next
      // tick retries them instead of silently dropping the batch. Duplicates
      // are acceptable for append-only analytics; loss is not.
      let requeued = 0;
      let deadLettered = 0;
      for (const appKey of failedAppIds) {
        for (const raw of rawsByApp[appKey] ?? []) {
          const payload = this.nextAttemptPayload(raw);
          if (payload) {
            await this.redis.getClient().lpush(RedisKeys.WEB_REPORT_DATAS, payload);
            requeued += 1;
          } else {
            await this.redis.getClient().lpush(RedisKeys.WEB_REPORT_DEAD_LETTERS, raw);
            await this.redis.getClient().ltrim(RedisKeys.WEB_REPORT_DEAD_LETTERS, 0, MAX_DEAD_LETTER_ENTRIES - 1);
            deadLettered += 1;
          }
        }
      }
      this.logger.warn(
        `web report flush failed; re-queued ${requeued}, dead-lettered ${deadLettered} reports for apps: ${[...failedAppIds].join(",")}`,
      );
    }
    if (failedItems) {
      this.logger.warn(`web report tick dropped ${failedItems} unparseable/poisoned report(s) out of ${raws.length}`);
    }
  }

  // Every requeue adds an attempt marker. An item that can never be written
  // (an unknown poison vector) must not cycle forever: after
  // MAX_REPORT_ATTEMPTS deliveries it is parked in the dead-letter list
  // instead of starving the queue (R15-01/R9-07).
  private nextAttemptPayload(raw: string): string | null {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    const attempts = (Number(payload.__reportAttempts) || 0) + 1;
    if (attempts >= MAX_REPORT_ATTEMPTS) return null;
    return JSON.stringify({ ...payload, __reportAttempts: attempts });
  }

  private async flushBuckets(buckets: DrainBuckets): Promise<Set<string>> {
    const failedAppIds = new Set<string>();
    const flush = async (label: string, appKey: string, write: () => Promise<unknown>) => {
      try {
        await write();
      } catch (e: unknown) {
        // One failing destination must not suppress the remaining flushes.
        failedAppIds.add(appKey);
        this.logger.error(`web report flush failed (${label})`, getErrorMessage(e));
      }
    };
    for (const appKey of Object.keys(buckets.appAjaxs)) {
      const rows = buckets.appAjaxs[appKey];
      if (rows.length)
        await flush(`ajax:${appKey}`, appKey, async () => (await this.ch.WebAjax(appKey)).insertMany(rows));
    }
    for (const appKey of Object.keys(buckets.appErrors)) {
      const rows = buckets.appErrors[appKey];
      if (rows.length)
        await flush(`error:${appKey}`, appKey, async () => (await this.ch.WebError(appKey)).insertMany(rows));
    }
    if (buckets.sdkErrors.length) {
      // SDK-error payloads are not produced by handleWebData today; a failure
      // here cannot be attributed to a single app, so it is logged but not
      // re-queued (no raws are keyed under the empty app id).
      await flush("sdk-error", "", async () => (await this.ch.WebSdkError()).insertMany(buckets.sdkErrors));
    }
    for (const appKey of Object.keys(buckets.appPages)) {
      const rows = buckets.appPages[appKey];
      if (rows.length) await flush(`page:${appKey}`, appKey, () => this.models.WebPage(appKey).insertMany(rows));
    }
    for (const appKey of Object.keys(buckets.appEnvironments)) {
      const rows = buckets.appEnvironments[appKey];
      if (rows.length)
        await flush(`environment:${appKey}`, appKey, () => this.models.WebEnvironment(appKey).insertMany(rows));
    }
    for (const appKey of Object.keys(buckets.appResources)) {
      const rows = buckets.appResources[appKey];
      if (rows.length)
        await flush(`resource:${appKey}`, appKey, () => this.models.WebResource(appKey).insertMany(rows));
    }
    for (const appKey of Object.keys(buckets.appCustoms)) {
      const rows = buckets.appCustoms[appKey];
      if (rows.length) await flush(`custom:${appKey}`, appKey, () => this.models.WebCustom(appKey).insertMany(rows));
    }
    return failedAppIds;
  }

  private handleWebData(query: Record<string, unknown>): WebReportItem {
    const str = (value: unknown, fallback = "") => (typeof value === "string" && value ? value : fallback);
    const item: WebReportItem = {
      appKey: str(query.appKey),
      createTime: func.toDateOrNow(query.time),
      userAgent: str(query.userAgent),
      ip: str(query.ip) || undefined,
      markPage: str(query.markPage, func.randomString()),
      markUser: str(query.markUser),
      markUv: str(query.markUv),
      markDevice: str(query.markDevice),
      url: str(query.url),
      // The encrypted phone is declared a string; a non-string payload value
      // must not reach a String column (Mongoose cast error → requeue loop).
      p: str(query.p) || undefined,
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
    const rawDuration = func.toNumberOrUndefined(item.duration);
    // Invalid duration falls back to 0 for the row write — CH silently
    // coerces NaN to 0 anyway (R12-02), but we normalize on the way in
    // so the value is explicit. The upper clamp keeps a client-supplied
    // 1e21 from overflowing UInt32 and failing the whole batch (R20-04).
    const duration = Math.min(Math.floor(Math.abs((rawDuration ?? 0) as number)), MAX_DURATION_MS);

    const _ajax: Record<string, unknown> = {
      appKey: data.appKey,
      createTime: item.requestTime ? func.toDateOrNow(item.requestTime) : data.createTime,
    };
    _ajax.url = newName || "";
    _ajax.fullUrl = func.toStringOrUndefined(item.name) ?? "";
    _ajax.method = func.toStringOrUndefined(item.method) ?? "";
    _ajax.duration = duration;
    // bodySize: skip write for invalid values — CH Nullable column (or just
    // let CH coerce to 0; we normalize to make the intent explicit).
    const bs = func.toNumberOrUndefined(item.bodySize);
    if (bs !== undefined) _ajax.bodySize = bs;
    _ajax.callUrl = data.url || "";
    if (item.options) _ajax.options = func.filterKeyWord(item.options);
    try {
      const newurl = new URL(String(item.name));
      if (newurl.searchParams.toString()) _ajax.query = newurl.searchParams.toString();
    } catch {
      // Expected failure: the URL may be malformed — skip query extraction.
    }
    if (item.traceId) _ajax.traceId = func.toStringOrUndefined(item.traceId) ?? "";
    if (data.uid) _ajax.uid = String(data.uid);
    if (data.p) _ajax.phone = func.decryptPhone(data.p);
    _ajax.markPage = data.markPage || "";
    _ajax.markUser = data.markUser || "";

    this.pushRow(appAjaxs, data.appKey, _ajax);
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
      errors.createTime = item.createTime ? func.toDateOrNow(item.createTime) : data.createTime;

      if (typeof item.msg === "object") errors.msg = JSON.stringify(item.msg);
      else if (typeof item.msg === "string") errors.msg = item.msg;
      else errors.msg = item.msg || "";

      errors.type = func.toStringOrUndefined(item.type) ?? "";
      errors.name = func.toStringOrUndefined(item.name) ?? "";
      errors.api = func.toStringOrUndefined(item.api) ?? "";
      if (Array.isArray(item.stack)) errors.stack = JSON.stringify(item.stack);
      errors.target = func.toStringOrUndefined(itemData.target) ?? "";
      errors.status = itemData.status ? String(itemData.status) : "";
      errors.col = itemData.col ? String(itemData.col) : "";
      errors.line = itemData.line ? String(itemData.line) : "";
      errors.method = func.toStringOrUndefined(item.method) ?? "";

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

      this.pushRow(appErrors, data.appKey, errors);
    }
  }
}
