# task-scheduling

General-purpose in-process scheduling platform. Business code registers handlers and declares default jobs; the scheduler treats database rows as the source of truth, syncing job declarations into cron jobs and recording every execution history.

## Working model

1. **Register handlers**: business modules inject `HandlerRegistryService` and call `registerHandler(key, fn)` at startup; `fn` has signature `(payload?: unknown) => Promise<void>`.
2. **Declare default jobs**: inject `TaskSchedulerService` and call `upsertJobDeclaration({ key, handlerKey, cronExpr, timezone })`. Declarations only create missing rows. At runtime jobs can be paused or their cron changed in the database; restarts do not overwrite them.

As a convenience, a concrete job can instead extend the abstract `ScheduledTask` base class (from `scheduler/scheduled-task.ts`): declare `jobKey`/`cronExpr`/`timezone`/`enabled` and implement `handle()`; the base class registers the handler and declares the job on module init.
3. **Reconcile**: every 30 seconds the scheduler syncs enabled jobs into dynamic cron jobs (`@nestjs/schedule` + `cron`); disabled or deleted jobs are removed.
4. **Execution and reentrancy guard**: when due, the corresponding handler fires; if the previous run of the same job has not finished, the current run is recorded as `skipped` (in-process reentrancy guard, no distributed lock). Manual triggers go through `POST /task-scheduling/jobs/:key/trigger`.
5. **Runtime editing**: `PATCH /task-scheduling/jobs/:key` can change `enabled` / `cronExpr` / `timezone` (invalid cron/timezone returns 400). Changes trigger an immediate reconcile without waiting for the next 30s tick; `key`/`handlerKey`/`payload` remain owned by the declaration side.
6. **Execution history**: `ScheduledJobRun` records trigger (schedule/manual), status (running/success/failed/skipped), duration, and error message.

## Assembly conventions

- This module is the sole owner of `ScheduleModule.forRoot()` and re-exports it; do not import a second forRoot in the same application, otherwise `@Cron` handlers will be registered twice.
- Default timezone is `Asia/Shanghai`.
