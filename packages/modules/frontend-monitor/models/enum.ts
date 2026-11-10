export enum ClickHouseTablePrefix {
  WEB_AJAX = "frontend_monitor_requests_",
  WEB_ERROR = "frontend_monitor_errors_",
  WEB_SDK_ERROR = "frontend_monitor_sdk_errors",
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

// All frontend-monitor keys live under a shared namespace because the application
// owns one Redis connection/database (the redis foundation module).
export enum RedisKeys {
  WEB_REPORT_DATAS = "frontend-monitor:WebReportDatas",
  WEB_REPORT_DEAD_LETTERS = "frontend-monitor:WebReportDeadLetters",
  PVUVIP_PRE_MINUTE_LOCK = "frontend-monitor:PvuvipPreMinuteLock",
  IP_TASK_LOCK = "frontend-monitor:IpTaskLock",
  DAY_REPORT_NUM_TASK_LOCK = "frontend-monitor:DayReportNumTaskLock",
  ALERT_EVALUATION_TASK_LOCK = "frontend-monitor:AlertEvaluationTaskLock",
}

export enum RedisKeyPrefix {
  IP_TASK_BEGIN_TIME = "frontend-monitor:IpTaskBeginTime_",
  DAY_REPORT_NUM = "frontend-monitor:DayReportNum_",
  IP_GEO_CACHE = "frontend-monitor:ip:",
}

export enum ReportType {
  PagePerf = "PagePerf",
  AjaxPerf = "AjaxPerf",
  Error = "Error",
  Custom = "Custom",
  Unload = "Unload",
  SdkError = "SdkError",
}
