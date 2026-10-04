# job-scheduler

General-purpose in-process scheduling platform. Business code registers job handlers and declares default schedules; the scheduler treats database rows as the source of truth, syncing schedule declarations into cron jobs and recording every execution run.

## Working model

1. **Register job handlers**: business modules inject `JobHandlerRegistryService` and call `registerHandler(key, fn)` at startup; `fn` has signature `(payload?: unknown) => Promise<void>`.
2. **Declare default schedules**: inject `JobSchedulerService` and call `upsertScheduleDeclaration({ key, handlerKey, cronExpr, timezone })`. Declarations only create missing rows. At runtime schedules can be paused or their cron changed in the database; restarts do not overwrite them.

As a convenience, a concrete scheduled job can instead extend the abstract `ScheduledJob` base class (from `scheduler/scheduled-job.ts`): declare `key`/`cronExpr`/`timezone`/`enabled` and implement `handle()`; the base class registers the job handler and declares the schedule on module init.

3. **Reconcile**: every 30 seconds the scheduler syncs enabled schedules into dynamic cron jobs (`@nestjs/schedule` + `cron`); disabled or deleted schedules are removed.
4. **Execution and reentrancy guard**: when due, the corresponding job handler fires; if the previous run of the same schedule has not finished, the current run is recorded as `skipped` (in-process reentrancy guard, no distributed lock). Manual triggers go through `POST /job-scheduler/schedules/:key/trigger`.
5. **Runtime editing**: `PATCH /job-scheduler/schedules/:key` can change `enabled` / `cronExpr` / `timezone` (invalid cron/timezone returns 400). Changes trigger an immediate reconcile without waiting for the next 30s tick; `key`/`handlerKey`/`payload` remain owned by the declaration side.
6. **Execution history**: `JobRun` records trigger (schedule/manual), status (running/success/failed/skipped), duration, and error message.

## Assembly conventions

- This module is the sole owner of `ScheduleModule.forRoot()` and re-exports it; do not import a second forRoot in the same application, otherwise `@Cron` handlers will be registered twice.
- Default timezone is `Asia/Shanghai`.
- Job concurrency protection is process-local. It is a re-entry guard, not a distributed lock.
- Job keys follow `{domain}.{verb}[-{object}]` (e.g. `aws.audit`, `web.evaluate-threshold-alerts`). The domain prefix mirrors the notification-center key convention, but job keys are verb phrases (the actor) while notification keys are nouns/states (the event).
- The `scheduleKey` filter of `GET /job-scheduler/runs` only accepts an exact schedule key; callers narrow by domain on the request side.
