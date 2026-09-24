import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {RedisService} from '../../../models/redis/redis.service';
import {SystemService} from '../../../modules/system/system.service';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {func} from '../../../shared/utils';
import {UAParser} from 'ua-parser-js';
import {RedisKeys, ReportType} from '../../../models/enum';

@Injectable()
export class WebReportTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly system: SystemService,
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }
  private async getWebItemDataForRedis({
    appAjaxs,
    appErrors,
  }: {
    appAjaxs: Record<string, any[]>;
    appErrors: Record<string, any[]>;
  }) {
    let query: any = await this.redis.rpop(RedisKeys.WEB_REPORT_DATAS);
    if (!query) return;
    try {
      query = JSON.parse(query);
    } catch {
      return;
    }
    const querytype = query.type || ReportType.PagePerf;
    const item = await this.handleWebData(query);
    if (query.type === ReportType.SdkError) {
      await this.saveSdkError(item);
      return;
    }
    const system = await this.system.getSystemForAppId(item.appId);
    if (!system || system.isUse !== 0) return;
    // TODO querytype === 'PagePerf'
    if (system.isStatisiPages === 0 && querytype === ReportType.PagePerf)
      await this.savePages(item, system.slowPageTime);
    if (system.isStatisiResource === 0 || system.isStatisiAjax === 0) this.forEachResources(item, system, appAjaxs);
    if (system.isStatisiError === 0) await this.collectErrors(item, appErrors);
    if (system.isStatisiSystem === 0 && querytype === ReportType.PagePerf) await this.saveEnvironment(item);
    await this.saveCustoms(item);
  }

  private async savePages(item: any, slowPageTime = 5) {
    const performance = item.performance || {};
    let newName = '';
    try {
      const u = new URL(func.urlHelper(item.url));
      newName = `${u.protocol}//${u.host}${u.pathname}${u.hash ? u.hash : ''}`;
    } catch {
      newName = item.url || '';
    }
    slowPageTime = slowPageTime * 1000;
    const speedType = performance.lodt >= slowPageTime ? 2 : 1;
    const PageModel = this.models.WebPage(item.appId);
    const pages = new PageModel();
    pages.appId = item.appId;
    pages.createTime = item.createTime;
    pages.url = newName;
    pages.fullUrl = item.url;
    pages.preUrl = item.preUrl;
    pages.speedType = speedType;
    pages.isFirstIn = item.isFirstIn;
    pages.markPage = item.markPage;
    pages.markUser = item.markUser;
    if (performance.wit !== undefined) pages.whiteTime = performance.wit;
    if (performance.dnst !== undefined) pages.dnsTime = performance.dnst;
    if (performance.lodt !== undefined) pages.loadTime = performance.lodt;
    if (performance.reqt !== undefined) pages.requestTime = performance.reqt;
    if (performance.tcpt !== undefined) pages.tcpTime = performance.tcpt;
    if (performance.andt !== undefined) pages.analysisDomTime = performance.andt;
    pages.screenWidth = item.screenWidth;
    pages.screenHeight = item.screenHeight;
    await pages.save();
  }

  private async saveCustoms(data: any) {
    if (!data.customs || !data.customs.length) return;
    const CustomModel = this.models.WebCustom(data.appId);
    for (const item of data.customs) {
      const customs = new CustomModel();
      customs.appId = data.appId;
      customs.createTime = data.createTime;
      customs.markPage = data.markPage;
      customs.markUser = data.markUser;
      customs.path = '';
      customs.customName = item.customName;
      customs.customContent = item.customContent;
      if (item.customFilter && Object.prototype.toString.apply(item.customFilter) === '[object Object]') {
        Object.keys(item.customFilter).forEach(key => {
          if (typeof item.customFilter[key] === 'number') item.customFilter[key] = String(item.customFilter[key]);
        });
      }
      this.setUser(customs, data);
      customs.customFilter = item.customFilter;
      await customs.save();
    }
  }

  private async saveResours(data: any, item: any, system: any) {
    let slowTime = 2;
    let speedType = 1;
    let duration = Math.floor(Math.abs(item.duration || 0));
    if (duration > 60000) duration = 60000;
    if (item.type === 'link' || item.type === 'css') slowTime = (system.slowCssTime || 2) * 1000;
    else if (item.type === 'script') slowTime = (system.slowJsTime || 2) * 1000;
    else if (item.type === 'img') slowTime = (system.slowImgTime || 2) * 1000;
    else slowTime = 2000;
    speedType = duration >= slowTime ? 2 : 1;
    if (duration < slowTime) return;
    let newName = '';
    try {
      const u = new URL(func.urlHelper(item.name));
      newName = `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      newName = item.name || '';
    }
    const ResourceModel = this.models.WebResource(data.appId);
    const resours = new ResourceModel();
    resours.appId = data.appId;
    resours.createTime = item.requestTime ? new Date(item.requestTime) : data.createTime;
    resours.url = data.url;
    resours.fullUrl = item.name;
    resours.speedType = speedType;
    resours.name = newName;
    resours.method = item.method;
    resours.type = item.type;
    resours.duration = duration;
    resours.bodySize = item.bodySize ? Number(item.bodySize) : 0;
    resours.nextHopProtocol = item.nextHopProtocol;
    resours.markPage = data.markPage;
    resours.markUser = data.markUser;
    this.setUser(resours, data);
    await resours.save();
  }

  private async saveEnvironment(data: any) {
    const ip = data.ip;
    if (!ip) return;
    let copyip = ip.split('.');
    copyip = `${copyip[0]}.${copyip[1]}.${copyip[2]}`;
    let datas: any = null;
    try {
      const s = await this.redis.get(copyip);
      if (s) datas = JSON.parse(s);
    } catch {
      datas = null;
    }
    const EnvModel = this.models.WebEnvironment(data.appId);
    const environment = new EnvModel();
    environment.appId = data.appId;
    environment.createTime = data.createTime;
    environment.url = data.url;
    environment.markPage = data.markPage;
    environment.markUser = data.markUser;
    environment.markUv = data.markUv;
    if (data.markDevice) environment.markDevice = data.markDevice;
    this.setUser(environment, data);

    const parser = new UAParser();
    parser.setUA(data.userAgent);
    const result = parser.getResult();
    environment.browser = result?.browser?.name || '';
    environment.browserVersion = result?.browser?.version || '';
    environment.system = result?.os?.name || '';
    environment.systemVersion = result?.os?.version || '';

    environment.ip = data.ip;
    environment.county = data.county;
    environment.province = data.province;
    if (datas) {
      environment.province = datas.province;
      environment.city = datas.city;
    }
    await environment.save();
  }

  private async saveSdkError(data: any) {
    const model = await this.ch.WebSdkError();
    const sdkErr = model.build();
    sdkErr.appId = data.appId;
    sdkErr.createTime = data.createTime;
    sdkErr.markUser = data.markUser;
    sdkErr.sdkVersion = data.sdkVersion;
    this.setUser(sdkErr, data);
    sdkErr.name = data.name;
    sdkErr.msg = data.msg;
    sdkErr.stack = data.stack;

    const parser = new UAParser();
    parser.setUA(data.userAgent);
    const result = parser.getResult();
    sdkErr.browser = result?.browser?.name || '';
    sdkErr.browserVersion = result?.browser?.version || '';
    sdkErr.system = result?.os?.name || '';
    sdkErr.systemVersion = result?.os?.version || '';

    await sdkErr.save();
  }

  private setUser(obj: any, data: any) {
    if (data.uid) obj.uid = String(data.uid);
    if (data.p) obj.phone = func.decryptPhone(data.p);
  }

  async saveWebReportDatasForRedis() {
    const count = this.cfg.redis_consumption?.thread_web || 1000;
    const appAjaxs: Record<string, any[]> = {};
    const appErrors: Record<string, any[]> = {};
    for (let i = 0; i < count; i++) {
      await this.getWebItemDataForRedis({appAjaxs, appErrors});
    }
    for (const appId of Object.keys(appAjaxs)) {
      const model = await this.ch.WebAjax(appId);
      if (appAjaxs[appId]?.length) await model.insertMany(appAjaxs[appId]);
    }
    for (const appId of Object.keys(appErrors)) {
      const model = await this.ch.WebError(appId);
      if (appErrors[appId]?.length) await model.insertMany(appErrors[appId]);
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
      markUser: query.markUser || '',
      markUv: query.markUv || '',
      markDevice: query.markDevice || '',
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

  private forEachResources(data: any, system: any, appAjaxs: Record<string, any[]>) {
    if (!data.resourceList || !data.resourceList.length) return;
    data.resourceList.forEach((item: any) => {
      if (item.type === 'xmlhttprequest' || item.type === 'fetchrequest' || item.type === 'fetch') {
        if (system.isStatisiAjax === 0) this.saveAjaxs(data, item, appAjaxs);
      } else {
        if (system.isStatisiResource === 0) this.saveResours(data, item, system);
      }
    });
  }

  private async saveAjaxs(data: any, item: any, appAjaxs: Record<string, any[]>) {
    let newName = '';
    try {
      const newurl = new URL(func.urlHelper(item.name));
      newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
    } catch {
      newName = item.name || '';
    }
    const duration = Math.floor(Math.abs(item.duration || 0));

    const model = await this.ch.WebAjax(data.appId);
    const _ajax = model.build();
    _ajax.appId = data.appId;
    _ajax.createTime = item.requestTime ? new Date(item.requestTime) : data.createTime;
    _ajax.url = newName || '';
    _ajax.fullUrl = item.name || '';
    _ajax.method = item.method || '';
    _ajax.duration = duration;
    _ajax.bodySize = item.bodySize ? Number(item.bodySize) : 0;
    _ajax.callUrl = data.url || '';
    if (item.options) _ajax.options = func.filterKeyWord(item.options);
    try {
      const newurl = new URL(item.name);
      if (newurl.searchParams.toString()) _ajax.query = newurl.searchParams.toString();
    } catch {}
    if (item.traceId) _ajax.traceId = item.traceId;
    if (data.uid) _ajax.uid = String(data.uid);
    if (data.p) _ajax.phone = func.decryptPhone(data.p);
    _ajax.markPage = data.markPage || '';
    _ajax.markUser = data.markUser || '';

    const bucket = appAjaxs[data.appId];
    if (bucket) bucket.push(_ajax);
    else appAjaxs[data.appId] = [_ajax];
  }

  private async collectErrors(data: any, appErrors: Record<string, any[]>) {
    if (!data.errorList || !data.errorList.length) return;
    for (const item of data.errorList) {
      if (item?.data?.resourceUrl && item.data.resourceUrl.startsWith('data://image')) continue;

      let newName = '';
      try {
        const newurl = new URL(func.urlHelper(item?.data?.resourceUrl || ''));
        newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
      } catch {
        newName = item?.data?.resourceUrl || '';
      }

      const model = await this.ch.WebError(data.appId);
      const errors = model.build();
      errors.resourceUrl = newName || '';
      errors.fullUrl = item?.data?.resourceUrl || '';
      errors.url = data.url || '';
      errors.createTime = item.createTime ? new Date(item.createTime) : data.createTime;

      if (typeof item.msg === 'object') errors.msg = JSON.stringify(item.msg);
      else if (typeof item.msg === 'string') errors.msg = item.msg;
      else errors.msg = item.msg || '';

      errors.type = item.type || '';
      errors.name = item.name || '';
      errors.api = item.api || '';
      if (Array.isArray(item.stack)) errors.stack = JSON.stringify(item.stack);
      errors.target = item?.data?.target || '';
      errors.status = item?.data?.status ? String(item.data.status) : '';
      errors.col = item?.data?.col ? String(item.data.col) : '';
      errors.line = item?.data?.line ? String(item.data.line) : '';
      errors.method = item.method || '';

      try {
        const u = new URL(item?.data?.resourceUrl || '');
        if (u.searchParams.toString()) errors.query = u.searchParams.toString();
      } catch {}
      if (item.options) errors.options = func.filterKeyWord(item.options);
      if (item.traceId) errors.traceId = item.traceId;

      errors.markPage = data.markPage || '';
      errors.markUser = data.markUser || '';
      if (data.uid) errors.uid = String(data.uid);
      if (data.p) errors.phone = func.decryptPhone(data.p);

      const bucket = appErrors[data.appId];
      if (bucket) bucket.push(errors);
      else appErrors[data.appId] = [errors];
    }
  }
}
