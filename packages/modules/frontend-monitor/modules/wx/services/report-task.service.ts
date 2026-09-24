import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {RedisService} from '../../../models/redis/redis.service';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {MonitorClickhouseService} from '../../../models/clickhouse/monitor-clickhouse.service';
import {SystemService} from '../../../modules/system/system.service';
import {func} from '../../../shared/utils';
import {RedisKeys, ReportType} from '../../../models/enum';

@Injectable()
export class WxReportTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly models: MonitorModelsService,
    private readonly ch: MonitorClickhouseService,
    private readonly system: SystemService
  ) {
    this.cfg = this.config.get('microservices.frontend-monitor');
  }

  async saveWxReportDatasForRedis() {
    const threads = this.cfg.redis_consumption?.thread_wx || 1;
    const appEvents: Record<string, any[]> = {};
    const appAjaxs: Record<string, any[]> = {};
    const appErrors: Record<string, any[]> = {};
    for (let i = 0; i < threads; i++) {
      await this.getWxItemDataForRedis({appEvents, appAjaxs, appErrors});
    }
    const eventIds = Object.keys(appEvents);
    for (const appId of eventIds) {
      const model = await this.ch.WxEvent(appId);
      await model.insertMany(appEvents[appId]);
    }
    const ajaxIds = Object.keys(appAjaxs);
    for (const appId of ajaxIds) {
      const model = await this.ch.WxAjax(appId);
      await model.insertMany(appAjaxs[appId]);
    }
    const errorIds = Object.keys(appErrors);
    for (const appId of errorIds) {
      const model = await this.ch.WxError(appId);
      await model.insertMany(appErrors[appId]);
    }
  }

  private async getWxItemDataForRedis({
    appEvents,
    appAjaxs,
    appErrors,
  }: {
    appEvents: Record<string, any[]>;
    appAjaxs: Record<string, any[]>;
    appErrors: Record<string, any[]>;
  }) {
    let query: any = await this.redis.rpop(RedisKeys.WX_REPORT_DATAS);
    if (!query) return;
    try {
      query = JSON.parse(query);
    } catch {
      return;
    }
    const querytype = query.type || ReportType.PagePerf;
    const item = await this.handleData(query);
    if (querytype === ReportType.SdkError) {
      await this.saveSdkError(item);
      return;
    }
    const system = await this.system.getSystemForAppId(item.appId);
    if (!system || system.isUse !== 0) return;
    if (system.isStatisiSystem === 0 && querytype === ReportType.PagePerf) await this.savePages(item);
    if (system.isStatisiAjax === 0) this.saveAjaxs(item, appAjaxs);
    if (system.isStatisiError === 0) this.saveErrors(item, appErrors);
    await this.saveCustoms(item);
    this.saveEvents(item, appEvents);
  }

  private async handleData(query: any) {
    const type = query.type || ReportType.PagePerf;
    let item: any = {
      appId: query.appId,
      createTime: query.time ? new Date(query.time) : new Date(),
      errs: query.errs,
      markPage: func.randomString(),
      markUser: query.markUser || '',
      markUv: query.markUv || '',
      markDevice: query.markDevice || '',
      pages: query.pages,
      ajaxs: query.ajaxs,
      customs: query.customs,
      events: query.events,
      p: query.p,
      uid: query.uid,
      ip: query.ip,
      net: query.net,
      system: query.system,
      loc: query.loc,
      userInfo: query.userInfo,
    };
    if (type === ReportType.SdkError) {
      item = Object.assign(item, {msg: query.msg, name: query.name, stack: query.stack, sdkVersion: query.version});
    }
    return item;
  }

  private async savePages(item: any) {
    const Model = this.models.WxPage(item.appId);
    const pages = new Model();
    pages.appId = item.appId;
    pages.createTime = item.createTime;
    pages.path = item.pages?.router;
    pages.options = item.pages?.options ? item.pages.options : {};
    pages.markPage = item.markPage;
    pages.markUser = item.markUser;
    if (item.markDevice) pages.markDevice = item.markDevice;
    pages.markUv = item.markUv;
    if (item.net) pages.net = item.net;
    if (item.ip) pages.ip = item.ip;
    if (item.system) {
      pages.brand = (item.system.brand || '').toLowerCase();
      pages.model = item.system.model;
      pages.screenWidth = item.system.screenWidth;
      pages.screenHeight = item.system.screenHeight;
      pages.language = item.system.language;
      pages.version = item.system.version;
      pages.system = item.system.system;
      pages.platform = item.system.platform;
      pages.sdkVersion = item.system.SDKVersion;
    }
    this.setUser(pages, item);
    if (item.ip) {
      let copyip = item.ip.split('.');
      copyip = `${copyip[0]}.${copyip[1]}.${copyip[2]}`;
      let datas: any = null;
      try {
        const s = await this.redis.get(copyip);
        if (s) datas = JSON.parse(s);
      } catch {}
      if (datas) {
        pages.province = datas.province;
        pages.city = datas.city;
      }
    }

    await pages.save();
  }

  private saveAjaxs(data: any, appAjaxs: Record<string, any[]>) {
    if (!data.ajaxs || !data.ajaxs.length) return;
    data.ajaxs.forEach(async (item: any) => {
      const duration = Math.floor(Math.abs(item.duration || 0));
      const newurl = new URL(func.urlHelper(item.name));
      const newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
      const model = await this.ch.WxAjax(data.appId);
      const ajaxs = model.build();
      ajaxs.createTime = data.createTime;
      ajaxs.url = newName || '';
      ajaxs.fullUrl = item.name || '';
      ajaxs.method = item.method || '';
      ajaxs.duration = duration;
      ajaxs.bodySize = item.bodySize ? Number(item.bodySize) : 0;
      if (item.options) ajaxs.options = func.filterKeyWord(item.options);
      if (newurl.searchParams.toString()) ajaxs.query = newurl.searchParams.toString();
      if (item.traceId) ajaxs.traceId = item.traceId;
      ajaxs.markPage = data.markPage || '';
      ajaxs.markUser = data.markUser || '';
      ajaxs.callUrl = data.pages?.router || '';
      this.setUserCH(ajaxs, data);
      const _appAjax = appAjaxs[data.appId];
      if (_appAjax) _appAjax.push(ajaxs);
      else appAjaxs[data.appId] = [ajaxs];
    });
  }

  private saveErrors(data: any, appErrors: Record<string, any[]>) {
    if (!data.errs || !data.errs.length) return;
    data.errs.forEach(async (item: any) => {
      const model = await this.ch.WxError(data.appId);
      const errors = model.build();
      if (['bussiness-ajax', 'ajax', 'fetch', 'bussiness-fetch'].indexOf(item.type) !== -1) {
        if (item.name && item.name.startsWith('data://image')) return;
        const newurl = new URL(func.urlHelper(item.name) || '');
        let newName = '';
        if (newurl.host) newName = `${newurl.protocol}//${newurl.host}${newurl.pathname}`;
        else newName = item.name || '';
        errors.name = newName;
        errors.fullName = item.name || '';
        if (newurl.searchParams.toString()) errors.query = newurl.searchParams.toString();
      } else {
        errors.name = item.name;
      }
      errors.createTime = data.createTime;
      if (func.isObject(item.msg)) errors.msg = JSON.stringify(item.msg);
      else if (typeof item.msg === 'string') {
        errors.msg = item.msg.replace(/\(\w*\)(?![^\(]*\()/g, '');
        const traceIdInMsgReg = item.msg.match(/[^(][a-zA-Z0-9]+(?=\))/g);
        if (traceIdInMsgReg && traceIdInMsgReg.length) errors.traceId = traceIdInMsgReg[traceIdInMsgReg.length - 1];
      } else {
        errors.msg = item.msg || '';
      }
      errors.type = item.type || '';
      errors.status = item.status ? item.status.toString() : '';
      errors.col = item.col ? item.col.toString() : '';
      errors.line = item.line ? item.line.toString() : '';
      if (item.options) errors.options = func.filterKeyWord(item.options);
      errors.method = item.method || '';
      if (item.traceId) errors.traceId = item.traceId;
      if (item.errorType) errors.errorType = item.errorType;
      if (item.stack) errors.stack = item.stack;
      this.setUserCH(errors, data);
      errors.markPage = data.markPage || '';
      errors.markUser = data.markUser || '';
      errors.path = data.pages?.router || '';
      const _appErrors = appErrors[data.appId];
      if (_appErrors) _appErrors.push(errors);
      else appErrors[data.appId] = [errors];
    });
  }

  private async saveCustoms(data: any) {
    if (!data.customs || !data.customs.length) return;
    const Model = this.models.WxCustom(data.appId);
    for (const item of data.customs) {
      const customs = new Model();
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

  private async saveEvents(data: any, appEvents: Record<string, any[]>) {
    if (!data.events || !data.events.length) return;
    for (const item of data.events) {
      const model = await this.ch.WxEvent(data.appId);
      const event = model.build();
      event.appId = data.appId;
      event.event = item.event;
      event.createTime = item.createTime ? new Date(item.createTime) : new Date();
      event.path = item.path || '';
      event.duration = item.duration || '';
      this.commonData(event, data);
      const list = appEvents[data.appId];
      if (list) list.push(event);
      else appEvents[data.appId] = [event];
    }
  }

  private commonData(model: any, sourceData: any) {
    model.markPage = sourceData.markPage;
    model.markUser = sourceData.markUser;
    model.markUv = sourceData.markUv;
    if (sourceData.net) model.net = sourceData.net;
    if (sourceData.ip) model.ip = sourceData.ip;
    this.setUserCH(model, sourceData);
    this.setSystem(model, sourceData);
  }

  private setSystem(model: any, sourceData: any) {
    const s = sourceData.system;
    if (!s) return;
    model.brand = (s.brand || '').toLowerCase();
    model.model = s.model;
    model.screenWidth = s.screenWidth;
    model.screenHeight = s.screenHeight;
    model.language = s.language;
    model.version = s.version;
    model.system = s.system;
    model.platform = s.platform;
    model.sdkVersion = s.SDKVersion;
  }

  private async saveSdkError(data: any) {
    const model = await this.ch.WxSdkError();
    const sdkErr = model.build();
    sdkErr.appId = data.appId;
    sdkErr.createTime = data.createTime;
    sdkErr.markUser = data.markUser;
    sdkErr.sdkVersion = data.sdkVersion;
    sdkErr.name = data.name;
    sdkErr.msg = data.msg;
    sdkErr.stack = data.stack;
    this.setUserCH(sdkErr, data);
    this.setSystem(sdkErr, data);
    await sdkErr.save();
  }

  private setUser(obj: any, data: any) {
    if (data.uid) obj.uid = data.uid;
    if (data.p) obj.phone = func.decryptPhone(data.p);
  }
  private setUserCH(obj: any, data: any) {
    if (data.uid) obj.uid = '' + data.uid;
    if (data.p) obj.phone = func.decryptPhone(data.p);
  }
}
