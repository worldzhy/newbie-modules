export enum ClickHouseTablePrefix {
  WEB_AJAX = 'WebAjax_',
  WEB_ERROR = 'WebErrors_',
  WEB_SDK_ERROR = 'WebSdkErrors',
  WX_AJAX = 'WxAjax_',
  WX_ERROR = 'WxErrors_',
  WX_EVENT = 'WxEvents_',
  WX_SDK_ERROR = 'WxSdkErrors',
}

export enum MongoCollectionPrefix {
  WEB_ENVIRONMENT = 'WebEnvironment_',
  WEB_PAGE = 'WebPages_',
  WEB_RESOURCE = 'WebResources_',
  WEB_CUSTOM = 'WebCustom_',
  WEB_CUSTOM_FILTER = 'WebCustomFilters_',
  WX_PAGE = 'WxPages_',
  WX_CUSTOM = 'WxCustom_',
  WX_CUSTOM_FILTER = 'WxCustomFilters_',
}

export enum MongoStaticCollection {
  System = 'System',
  Email = 'Email',
  DayReportNum = 'DayReportNum',
  WebPvUvIp = 'WebPvUvIp',
  WxPvUvIp = 'WxPvUvIp',
}

export enum RedisKeys {
  WEB_REPORT_DATAS = 'WebReportDatas',
  WX_REPORT_DATAS = 'WxReportDatas',
  PVUVIP_PRE_MINUTE_LOCK = 'PvuvipPreMinuteLock',
  IP_TASK_LOCK = 'IpTaskLock',
  DAY_REPORT_NUM_TASK_LOCK = 'DayReportNumTaskLock',
  DAY_REPORT_TASK_LOCK = 'DayReportTaskLock',
}

export enum RedisKeyPrefix {
  IP_TASK_BEGIN_TIME = 'IpTaskBeginTime_',
  WX_IP_TASK_BEGIN_TIME = 'WxIpTaskBeginTime_',
  DAY_REPORT_NUM = 'DayReportNum_',
}

export enum ReportType {
  PagePerf = 'PagePerf',
  AjaxPerf = 'AjaxPerf',
  Error = 'Error',
  Custom = 'Custom',
  Unload = 'Unload',
  SdkError = 'SdkError',
}
