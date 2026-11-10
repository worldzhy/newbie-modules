/**
 * Code-owned constants for frontend-monitor (sunk from newbie.module.json
 * config-service per ADR-033: values that ship with the code are code
 * constants, not assembly configuration). Key names match the former
 * manifest fields verbatim.
 */
export const WEB_MONITOR_CONFIG = {
  redis_consumption: {
    task_time: "*/10 * * * * *",
    thread_web: 1000,
    total_limit_web: 100000,
  },
  pvuvip_task_minute_cron_time: "0 */2 * * * *",
  pvuvip_task_minute_lock_time: 20,
  ipRedisTTL: 2592000,
  ip_task_lock_time: 20,
  ip_task_space_time: 60000,
  alertTaskLockTime: 20,
  alertWindowMs: 60000,
  is_web_consume_task_run: true,
  day_report_num_task_lock_time: 3000,
  ip_thread: 5,
  top_alalysis_size: { web: 10 },
  pageSize: 15,
} as const;
