export enum ClickHouseTablePrefix {
  WEB_AJAX = "web_monitor_requests_",
  WEB_ERROR = "web_monitor_errors_",
  WEB_SDK_ERROR = "web_monitor_sdk_errors",
}

export enum MongoCollectionPrefix {
  WEB_ENVIRONMENT = "WebEnvironment_",
  WEB_PAGE = "WebPages_",
  WEB_RESOURCE = "WebResources_",
  WEB_CUSTOM = "WebCustom_",
  WEB_CUSTOM_FILTER = "WebCustomFilters_",
}

export enum MongoStaticCollection {
  System = "System",
  DayReportNum = "DayReportNum",
  WebPvUvIp = "WebPvUvIp",
}

// All web-monitor keys live under a shared namespace because the application
// owns one Redis connection/database (the redis foundation module).
export enum RedisKeys {
  WEB_REPORT_DATAS = "web-monitor:WebReportDatas",
  PVUVIP_PRE_MINUTE_LOCK = "web-monitor:PvuvipPreMinuteLock",
  IP_TASK_LOCK = "web-monitor:IpTaskLock",
  DAY_REPORT_NUM_TASK_LOCK = "web-monitor:DayReportNumTaskLock",
  ALERT_EVALUATION_TASK_LOCK = "web-monitor:AlertEvaluationTaskLock",
}

export enum RedisKeyPrefix {
  IP_TASK_BEGIN_TIME = "web-monitor:IpTaskBeginTime_",
  DAY_REPORT_NUM = "web-monitor:DayReportNum_",
  IP_GEO_CACHE = "web-monitor:ip:",
}

export enum ReportType {
  PagePerf = "PagePerf",
  AjaxPerf = "AjaxPerf",
  Error = "Error",
  Custom = "Custom",
  Unload = "Unload",
  SdkError = "SdkError",
}
