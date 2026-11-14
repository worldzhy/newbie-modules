import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { JobHandlerRegistryService, JobHandler } from "./handler-registry.service";
import {
  JOB_RUN_FAILED_EVENT,
  JOB_RUN_SUCCEEDED_EVENT,
  type JobRunFailedEvent,
  type JobRunSucceededEvent,
} from "../job-scheduler.events";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

const RECONCILE_INTERVAL_MS = 30_000;
const CRON_JOB_NAME_PREFIX = "job-scheduler:";
export const DEFAULT_TIMEZONE = "Asia/Shanghai";
const PG_UNIQUE_VIOLATION = "P2002";
const STUCK_RUN_TIMEOUT_KEY = "modules.job-scheduler.stuckRunTimeoutMinutes";
const RETENTION_DAYS_KEY = "modules.job-scheduler.retentionDays";
/// The stale-run sweeps are bounded: a boot that finds more than this many
/// hung rows still starts, and the next trigger of each schedule converges the
/// rest.
const STUCK_RUN_SCAN_LIMIT = 100;
const RUN_PRUNE_INTERVAL_MS = 60 * 60_000;

/// Validates settings resolved from the assembler's bare env mapping
/// (ADR-033): declared positive integers, no built-in fallback.
function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  return value;
}

export type JobTrigger = "schedule" | "manual";

export interface JobScheduleDeclaration {
  key: string;
  name?: string;
  handlerKey: string;
  cronExpr: string;
  timezone?: string;
  isEnabled?: boolean;
  payload?: unknown;
}

interface JobScheduleRecord {
  id: number;
  key: string;
  name: string;
  handlerKey: string;
  cronExpr: string;
  timezone: string;
  isEnabled: boolean;
  payload: unknown;
}

@Injectable()
export class JobSchedulerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  /// Per-process reentry guard: keys of schedules whose run is still in progress.
  private readonly runningScheduleKeys = new Set<string>();
  /// What the in-memory cron jobs were built from, so reconcile can detect
  /// database-side cron/timezone drift without touching cron internals.
  private readonly registeredJobs = new Map<string, { cronExpr: string; timezone: string }>();
  private reconcileTimer?: NodeJS.Timeout;
  /// A running row older than this is declared failed by the scheduler itself
  /// (ADR-067 addendum), so a hung handler cannot stay invisible forever.
  private readonly stuckTimeoutMinutes: number;
  private readonly retentionDays: number;
  private lastRunPruneAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly jobHandlerRegistry: JobHandlerRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {
    this.stuckTimeoutMinutes = requirePositiveInteger(
      Number(this.config.getOrThrow<string>(STUCK_RUN_TIMEOUT_KEY)),
      STUCK_RUN_TIMEOUT_KEY,
    );
    this.retentionDays = requirePositiveInteger(
      Number(this.config.getOrThrow<string>(RETENTION_DAYS_KEY)),
      RETENTION_DAYS_KEY,
    );
  }

  async onModuleInit() {
    await this.reconcile();
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((error) => {
        this.logger.error(`Schedule reconcile failed: ${getErrorMessage(error)}`);
      });
    }, RECONCILE_INTERVAL_MS);
  }

  /// Rows left `running` by a previous process can never complete on their own;
  /// close them once the module is fully wired so the failure events still
  /// reach their listeners (ADR-067 addendum).
  async onApplicationBootstrap() {
    try {
      await this.failStuckRuns();
    } catch (error) {
      this.logger.error(`Stale run recovery failed: ${getErrorMessage(error)}`);
    }
  }

  onModuleDestroy() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }
  }

  /// Sync database schedule definitions into dynamic cron jobs: create/update
  /// for isEnabled schedules, remove cron jobs for disabled or deleted schedules.
  async reconcile() {
    const schedules = (await this.prisma.jobSchedule.findMany({
      orderBy: { key: "asc" },
    })) as unknown as JobScheduleRecord[];

    const desiredCronJobNames = new Set<string>();

    for (const schedule of schedules) {
      if (!schedule.isEnabled) {
        continue;
      }

      const cronJobName = this.cronJobName(schedule.key);
      desiredCronJobNames.add(cronJobName);

      const registered = this.registeredJobs.get(cronJobName);
      if (registered && registered.cronExpr === schedule.cronExpr && registered.timezone === schedule.timezone) {
        continue;
      }

      this.deleteCronJob(cronJobName);
      this.addCronJob(schedule, cronJobName);
      this.registeredJobs.set(cronJobName, { cronExpr: schedule.cronExpr, timezone: schedule.timezone });
    }

    for (const cronJobName of this.registeredJobs.keys()) {
      if (!desiredCronJobNames.has(cronJobName)) {
        this.deleteCronJob(cronJobName);
        this.registeredJobs.delete(cronJobName);
      }
    }
  }

  /// Manually trigger a schedule regardless of its `isEnabled` flag. Still
  /// subject to the same reentry guard: while a run is in progress the run is
  /// recorded as `skipped`.
  async triggerSchedule(key: string) {
    const schedule = await this.prisma.jobSchedule.findUnique({ where: { key } });
    if (!schedule) {
      throw new NotFoundException(`Job schedule not found: ${key}`);
    }
    return this.executeSchedule(schedule as unknown as JobScheduleRecord, "manual");
  }

  /// Declare a default schedule from business code. The database row wins for
  /// runtime settings: declarations only create missing rows, never override
  /// cron/timezone/isEnabled edits. The display name stays declaration-owned and
  /// is re-synced on every startup.
  async upsertScheduleDeclaration(declaration: JobScheduleDeclaration): Promise<void> {
    const existing = await this.prisma.jobSchedule.findUnique({ where: { key: declaration.key } });

    if (existing) {
      const declaredName = declaration.name ?? "";
      if (existing.name !== declaredName) {
        await this.prisma.jobSchedule.update({ where: { key: declaration.key }, data: { name: declaredName } });
      }
      return;
    }

    try {
      await this.prisma.jobSchedule.create({
        data: {
          key: declaration.key,
          name: declaration.name ?? "",
          handlerKey: declaration.handlerKey,
          cronExpr: declaration.cronExpr,
          timezone: declaration.timezone ?? DEFAULT_TIMEZONE,
          isEnabled: declaration.isEnabled ?? true,
          // Nullable Json column: DbNull stores NULL; an object must satisfy
          // InputJsonValue. Plain null is rejected by Prisma's input types.
          payload: declaration.payload == null ? Prisma.DbNull : (declaration.payload as Prisma.InputJsonValue),
          createdVia: "declaration",
        },
      });
      this.logger.log(
        `Job schedule declared: ${declaration.key} (${declaration.cronExpr} ${
          declaration.timezone ?? DEFAULT_TIMEZONE
        })`,
      );
    } catch (error: unknown) {
      // Concurrent declaration (e.g. another process bootstrapping) won the race.
      if ((error as { code?: string })?.code !== PG_UNIQUE_VIOLATION) {
        throw error;
      }
    }
  }

  /// Update the runtime-editable fields of a schedule, then reconcile
  /// immediately so the change takes effect without waiting for the next 30s
  /// reconcile tick. Only isEnabled/cronExpr/timezone are editable here; key,
  /// handlerKey and payload stay declaration-owned.
  async updateSchedule(key: string, updates: { isEnabled?: boolean; cronExpr?: string; timezone?: string }) {
    const schedule = await this.prisma.jobSchedule.findUnique({ where: { key } });
    if (!schedule) {
      throw new NotFoundException(`Job schedule not found: ${key}`);
    }

    const hasUpdate =
      updates.isEnabled !== undefined || updates.cronExpr !== undefined || updates.timezone !== undefined;
    if (!hasUpdate) {
      throw new BadRequestException("No updatable fields provided. Supported fields: isEnabled, cronExpr, timezone.");
    }

    const nextCronExpr = updates.cronExpr ?? schedule.cronExpr;
    const nextTimezone = updates.timezone ?? schedule.timezone;
    if (updates.cronExpr !== undefined || updates.timezone !== undefined) {
      this.assertValidCron(nextCronExpr, nextTimezone);
    }

    const updated = await this.prisma.jobSchedule.update({
      where: { key },
      data: {
        ...(updates.isEnabled !== undefined ? { isEnabled: updates.isEnabled } : {}),
        ...(updates.cronExpr !== undefined ? { cronExpr: updates.cronExpr } : {}),
        ...(updates.timezone !== undefined ? { timezone: updates.timezone } : {}),
      },
    });

    await this.reconcile();
    return { ...updated, nextRunAt: this.computeNextRunAt(updated) };
  }

  async listSchedules() {
    const schedules = await this.prisma.jobSchedule.findMany({ orderBy: { key: "asc" } });
    return schedules.map((schedule) => ({ ...schedule, nextRunAt: this.computeNextRunAt(schedule) }));
  }

  async listScheduleRuns(key: string, page?: number, pageSize?: number) {
    const schedule = await this.prisma.jobSchedule.findUnique({ where: { key } });
    if (!schedule) {
      throw new NotFoundException(`Job schedule not found: ${key}`);
    }

    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.JobRun,
      pagination: { page, pageSize },
      findManyArgs: { where: { scheduleId: schedule.id }, orderBy: { startedAt: "desc" } },
    });
  }

  /// Constructing a CronJob (without starting it) validates both the cron
  /// expression and the timezone synchronously; invalid values throw.
  private assertValidCron(cronExpr: string, timezone: string) {
    try {
      new CronJob(cronExpr, () => {}, null, false, timezone);
    } catch (error) {
      throw new BadRequestException(
        `Invalid cron expression or timezone: "${cronExpr}" (${timezone}) — ${getErrorMessage(error)}`,
      );
    }
  }

  /// Next execution time for an enabled schedule, computed with the same cron
  /// library and timezone the in-memory job runs with. Paused schedules have no
  /// next run; an invalid expression yields null instead of failing the list.
  private computeNextRunAt(schedule: { isEnabled: boolean; cronExpr: string; timezone: string }): Date | null {
    if (!schedule.isEnabled) {
      return null;
    }
    try {
      const cronJob = new CronJob(schedule.cronExpr, () => {}, null, false, schedule.timezone || DEFAULT_TIMEZONE);
      return cronJob.nextDate().toJSDate();
    } catch {
      return null;
    }
  }

  private addCronJob(schedule: JobScheduleRecord, cronJobName: string) {
    const cronJob = new CronJob(
      schedule.cronExpr,
      () => {
        this.executeSchedule(schedule, "schedule").catch((error) => {
          this.logger.error(`Schedule ${schedule.key} failed unexpectedly: ${getErrorMessage(error)}`);
        });
      },
      null,
      false,
      schedule.timezone || DEFAULT_TIMEZONE,
    );

    this.schedulerRegistry.addCronJob(cronJobName, cronJob);
    cronJob.start();
    this.logger.log(`Cron job started for schedule ${schedule.key}: ${schedule.cronExpr} (${schedule.timezone})`);
  }

  private deleteCronJob(cronJobName: string) {
    try {
      const cronJob = this.schedulerRegistry.getCronJob(cronJobName);
      cronJob.stop();
      this.schedulerRegistry.deleteCronJob(cronJobName);
    } catch {
      // The job was never registered (e.g. invalid cron on a previous reconcile).
    }
  }

  private async executeSchedule(schedule: JobScheduleRecord, trigger: JobTrigger) {
    await this.pruneExpiredRuns();
    if (this.runningScheduleKeys.has(schedule.key)) {
      this.logger.warn(`Skipping ${trigger} run of schedule ${schedule.key}: previous run is still in progress.`);
      // The guard is process-local, so a hung handler never gets a chance to
      // report itself. A run that has been running past the threshold is
      // closed here and announced through the existing failure event
      // (ADR-067 addendum); this trigger still records `skipped`.
      try {
        await this.failStuckRuns(schedule.id);
      } catch (error) {
        this.logger.error(`Stuck run check for ${schedule.key} failed: ${getErrorMessage(error)}`);
      }
      return this.prisma.jobRun.create({
        data: {
          scheduleId: schedule.id,
          trigger,
          status: "skipped",
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          error: "Previous run is still in progress.",
        },
      });
    }

    this.runningScheduleKeys.add(schedule.key);
    const startedAt = new Date();
    const run = await this.prisma.jobRun.create({
      data: { scheduleId: schedule.id, trigger, status: "running", startedAt },
    });

    try {
      const handler: JobHandler | undefined = this.jobHandlerRegistry.getHandler(schedule.handlerKey);
      if (!handler) {
        throw new Error(`Job handler is not registered: ${schedule.handlerKey}`);
      }
      await handler(schedule.payload ?? undefined);

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const succeededRun = await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt,
          durationMs,
        },
      });
      // Fire only after the successful run is persisted; a failing listener
      // must never turn a recorded success into a failed run (ADR-067).
      try {
        this.eventEmitter.emit(JOB_RUN_SUCCEEDED_EVENT, {
          runId: succeededRun.id,
          scheduleId: schedule.id,
          scheduleKey: schedule.key,
          handlerKey: schedule.handlerKey,
          trigger,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs,
        } satisfies JobRunSucceededEvent);
      } catch (listenerError) {
        this.logger.error(
          `Failed to emit ${JOB_RUN_SUCCEEDED_EVENT} for run ${run.id}: ${getErrorMessage(listenerError)}`,
        );
      }
      return succeededRun;
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage = getErrorMessage(error);
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      this.logger.error(`Schedule ${schedule.key} ${trigger} run failed after ${durationMs}ms: ${errorMessage}`);
      const failedRun = await this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs,
          error: errorMessage.slice(0, 2000),
        },
      });
      // Fire only after the failed run is persisted; listeners must never mask
      // the recorded run, so a failing listener is logged, never rethrown here.
      try {
        this.eventEmitter.emit(JOB_RUN_FAILED_EVENT, {
          runId: failedRun.id,
          scheduleId: schedule.id,
          scheduleKey: schedule.key,
          handlerKey: schedule.handlerKey,
          trigger,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs,
          error: errorMessage,
        } satisfies JobRunFailedEvent);
      } catch (listenerError) {
        this.logger.error(
          `Failed to emit ${JOB_RUN_FAILED_EVENT} for run ${run.id}: ${getErrorMessage(listenerError)}`,
        );
      }
      return failedRun;
    } finally {
      this.runningScheduleKeys.delete(schedule.key);
    }
  }

  private cronJobName(key: string): string {
    return `${CRON_JOB_NAME_PREFIX}${key}`;
  }

  /// Close `running` rows older than the stuck threshold. Called at boot (for
  /// rows a previous process left behind) and from the reentry guard (for a
  /// handler that never returns). The conditional update keeps a run that
  /// finished meanwhile untouched.
  private async failStuckRuns(scheduleId?: number): Promise<void> {
    const cutoff = new Date(Date.now() - this.stuckTimeoutMinutes * 60_000);
    const stale = await this.prisma.jobRun.findMany({
      where: {
        status: "running",
        startedAt: { lt: cutoff },
        ...(scheduleId === undefined ? {} : { scheduleId }),
      },
      orderBy: { startedAt: "asc" },
      take: STUCK_RUN_SCAN_LIMIT,
      include: { schedule: { select: { key: true, handlerKey: true } } },
    });

    for (const run of stale) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - run.startedAt.getTime();
      const error = `Run exceeded the stuck-run threshold of ${this.stuckTimeoutMinutes} minutes; marked failed by the scheduler.`;
      const claimed = await this.prisma.jobRun.updateMany({
        where: { id: run.id, status: "running" },
        data: { status: "failed", finishedAt, durationMs, error },
      });
      if (claimed.count === 0) {
        continue;
      }
      this.logger.error(
        `Marked stuck run ${run.id} of schedule ${run.schedule.key} as failed after ${durationMs}ms (limit ${this.stuckTimeoutMinutes}m).`,
      );
      // Reuse the existing failure event: the host already maps it to a
      // lifecycle alert, and a second event type would need its own contract.
      try {
        this.eventEmitter.emit(JOB_RUN_FAILED_EVENT, {
          runId: run.id,
          scheduleId: run.scheduleId,
          scheduleKey: run.schedule.key,
          handlerKey: run.schedule.handlerKey,
          trigger: run.trigger as JobTrigger,
          startedAt: run.startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs,
          error,
        } satisfies JobRunFailedEvent);
      } catch (listenerError) {
        this.logger.error(
          `Failed to emit ${JOB_RUN_FAILED_EVENT} for stuck run ${run.id}: ${getErrorMessage(listenerError)}`,
        );
      }
    }
  }

  /// Lazy retention, following event-emitter: prune on the write path, but at
  /// most once per hour so a job running every minute does not scan the whole
  /// history on every run.
  private async pruneExpiredRuns(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRunPruneAt < RUN_PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastRunPruneAt = now;
    const cutoff = new Date(now - this.retentionDays * 24 * 60 * 60_000);
    try {
      const { count } = await this.prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
      if (count > 0) {
        this.logger.log(`Pruned ${count} job run(s) older than ${this.retentionDays} days.`);
      }
    } catch (error) {
      this.logger.error(`Job run retention prune failed: ${getErrorMessage(error)}`);
    }
  }
}
