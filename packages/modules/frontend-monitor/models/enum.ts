export enum ClickHouseTablePrefix {
  FRONTEND_AJAX = "frontend_monitor_requests_",
  FRONTEND_ERROR = "frontend_monitor_errors_",
  FRONTEND_SDK_ERROR = "frontend_monitor_sdk_errors",
}

export enum MongoCollectionPrefix {
  FRONTEND_ENVIRONMENT = "FrontendEnvironment_",
  FRONTEND_PAGE = "FrontendPages_",
  FRONTEND_RESOURCE = "FrontendResources_",
  FRONTEND_CUSTOM = "FrontendCustom_",
  FRONTEND_CUSTOM_FILTER = "FrontendCustomFilters_",
}

export enum MongoStaticCollection {
  System = "System",
  DayReportNum = "DayReportNum",
  FrontendPvUvIp = "FrontendPvUvIp",
}

// All frontend-monitor keys live under a shared namespace because the application
// owns one Redis connection/database (the redis foundation module).
export enum RedisKeys {
  FRONTEND_REPORT_DATAS = "frontend-monitor:FrontendReportDatas",
  FRONTEND_REPORT_DEAD_LETTERS = "frontend-monitor:FrontendReportDeadLetters",
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
