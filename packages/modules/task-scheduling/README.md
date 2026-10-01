# task-scheduling

通用进程内调度平台。业务代码注册 handler、声明默认任务；调度器以数据库行为准，将任务定义同步为 cron 作业，并记录每次执行历史。

## 工作模型

1. **注册 handler**：业务模块注入 `HandlerRegistryService`，在启动时 `registerHandler(key, fn)`，`fn` 签名为 `(payload?: unknown) => Promise<void>`。
2. **声明默认任务**：注入 `TaskSchedulerService`，调用 `upsertJobDeclaration({ key, handlerKey, cronExpr, timezone })`。声明只创建缺失行，运行后可在数据库中暂停任务、修改 cron，重新启动不会被覆盖。
3. **reconcile**：调度器每 30 秒把启用的任务同步为动态 cron 作业（`@nestjs/schedule` + `cron`），停用或删除的任务会被移除。
4. **执行与防重入**：到点触发对应 handler；同一任务上次运行未结束时本次记为 `skipped`（进程内防重入，不做分布式锁）。手动触发走 `POST /task-scheduling/jobs/:key/trigger`。
5. **运行时编辑**：`PATCH /task-scheduling/jobs/:key` 可改 `enabled` / `cronExpr` / `timezone`（非法 cron/时区返回 400），保存后立即 reconcile 生效，无需等下一个 30s tick；`key`/`handlerKey`/`payload` 仍归声明侧所有。
6. **执行历史**：`ScheduledJobRun` 记录 trigger（schedule/manual）、status（running/success/failed/skipped）、耗时与错误信息。

## 装配约定

- 本模块唯一持有 `ScheduleModule.forRoot()` 并将其 re-export；同一应用内不要再导入第二个 forRoot，否则 `@Cron` 处理器会被注册两次。
- 默认时区 `Asia/Shanghai`。
