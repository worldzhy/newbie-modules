import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EventCatalogService } from "@modules/event-emitter/event-catalog.service";
import { JobHandlerRegistryService, JobHandler } from "./handler-registry.service";

const RECONCILE_INTERVAL_MS = 30_000;
const CRON_JOB_NAME_PREFIX = "job-scheduler:";
export const DEFAULT_TIMEZONE = "Asia/Shanghai";
const PG_UNIQUE_VIOLATION = "P2002";

/// Emitted after a job run is persisted with status "failed". The scheduler
/// stays decoupled from notification-center; application-layer listeners turn
/// this event into notifications.
export const JOB_RUN_FAILED_EVENT = "job-scheduler.run-failed";

export type JobTrigger = "schedule" | "manual";

export interface JobRunFailedEvent {
  runId: number;
  scheduleId: number;
  scheduleKey: string;
  handlerKey: string;
  trigger: JobTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error: string;
}

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
export class JobSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobSchedulerService.name);
  /// Per-process reentry guard: keys of schedules whose run is still in progress.
  private readonly runningScheduleKeys = new Set<string>();
  /// What the in-memory cron jobs were built from, so reconcile can detect
  /// database-side cron/timezone drift without touching cron internals.
  private readonly registeredJobs = new Map<string, { cronExpr: string; timezone: string }>();
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly jobHandlerRegistry: JobHandlerRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly eventCatalog: EventCatalogService,
  ) {}

  async onModuleInit() {
    this.eventCatalog.declareEvent({
      key: JOB_RUN_FAILED_EVENT,
      name: "Job run failed",
      description: "Emitted after a scheduled or manual job run is persisted with status failed.",
      payloadExample: {
        runId: 42,
        scheduleId: 7,
        scheduleKey: "dependency-scan.daily",
        handlerKey: "dependency-scan.run",
        trigger: "schedule",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
        durationMs: 5000,
        error: "connect ETIMEDOUT 10.0.0.1:443",
      } satisfies JobRunFailedEvent,
    });
    await this.reconcile();
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((error) => {
        this.logger.error(`Schedule reconcile failed: ${this.getErrorMessage(error)}`);
      });
    }, RECONCILE_INTERVAL_MS);
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
    return updated;
  }

  listSchedules() {
    return this.prisma.jobSchedule.findMany({ orderBy: { key: "asc" } });
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
        `Invalid cron expression or timezone: "${cronExpr}" (${timezone}) — ${this.getErrorMessage(error)}`,
      );
    }
  }

  private addCronJob(schedule: JobScheduleRecord, cronJobName: string) {
    const cronJob = new CronJob(
      schedule.cronExpr,
      () => {
        this.executeSchedule(schedule, "schedule").catch((error) => {
          this.logger.error(`Schedule ${schedule.key} failed unexpectedly: ${this.getErrorMessage(error)}`);
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
    if (this.runningScheduleKeys.has(schedule.key)) {
      this.logger.warn(`Skipping ${trigger} run of schedule ${schedule.key}: previous run is still in progress.`);
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
      return this.prisma.jobRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        },
      });
    } catch (error) {
      const finishedAt = new Date();
      const errorMessage = this.getErrorMessage(error);
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
          `Failed to emit ${JOB_RUN_FAILED_EVENT} for run ${run.id}: ${this.getErrorMessage(listenerError)}`,
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

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
