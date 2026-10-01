import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { HandlerRegistryService, ScheduledHandler } from "./handler-registry.service";

const RECONCILE_INTERVAL_MS = 30_000;
const CRON_JOB_NAME_PREFIX = "task-scheduling:";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_RUN_LIMIT = 50;
const MAX_RUN_LIMIT = 200;
const PG_UNIQUE_VIOLATION = "P2002";

type JobTrigger = "schedule" | "manual";

export interface JobDeclaration {
  key: string;
  handlerKey: string;
  cronExpr: string;
  timezone?: string;
  enabled?: boolean;
  payload?: unknown;
}

interface ScheduledJobRecord {
  id: number;
  key: string;
  handlerKey: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  payload: unknown;
}

@Injectable()
export class TaskSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskSchedulerService.name);
  /// Per-process reentry guard: keys of jobs whose run is still in progress.
  private readonly runningJobKeys = new Set<string>();
  /// What the in-memory cron jobs were built from, so reconcile can detect
  /// database-side cron/timezone drift without touching cron internals.
  private readonly registeredJobs = new Map<string, { cronExpr: string; timezone: string }>();
  private reconcileTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly handlerRegistry: HandlerRegistryService,
  ) {}

  async onModuleInit() {
    await this.reconcile();
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch((error) => {
        this.logger.error(`Scheduled job reconcile failed: ${this.getErrorMessage(error)}`);
      });
    }, RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
    }
  }

  /// Sync database job definitions into dynamic cron jobs: create/update for
  /// enabled jobs, remove cron jobs for disabled or deleted definitions.
  async reconcile() {
    const jobs = (await this.prisma.scheduledJob.findMany({
      orderBy: { key: "asc" },
    })) as unknown as ScheduledJobRecord[];

    const desiredCronJobNames = new Set<string>();

    for (const job of jobs) {
      if (!job.enabled) {
        continue;
      }

      const cronJobName = this.cronJobName(job.key);
      desiredCronJobNames.add(cronJobName);

      const registered = this.registeredJobs.get(cronJobName);
      if (registered && registered.cronExpr === job.cronExpr && registered.timezone === job.timezone) {
        continue;
      }

      this.deleteCronJob(cronJobName);
      this.addCronJob(job, cronJobName);
      this.registeredJobs.set(cronJobName, { cronExpr: job.cronExpr, timezone: job.timezone });
    }

    for (const cronJobName of this.registeredJobs.keys()) {
      if (!desiredCronJobNames.has(cronJobName)) {
        this.deleteCronJob(cronJobName);
        this.registeredJobs.delete(cronJobName);
      }
    }
  }

  /// Manually trigger a job regardless of its `enabled` flag. Still subject to
  /// the same reentry guard: while a run is in progress the run is recorded as
  /// `skipped`.
  async triggerJob(key: string) {
    const job = await this.prisma.scheduledJob.findUnique({ where: { key } });
    if (!job) {
      throw new NotFoundException(`Scheduled job not found: ${key}`);
    }
    return this.executeJob(job as unknown as ScheduledJobRecord, "manual");
  }

  /// Declare a default job definition from business code. The database row
  /// wins: declarations only create missing rows, never override runtime edits.
  async upsertJobDeclaration(declaration: JobDeclaration): Promise<void> {
    const existing = await this.prisma.scheduledJob.findUnique({ where: { key: declaration.key } });
    if (existing) {
      return;
    }

    try {
      await this.prisma.scheduledJob.create({
        data: {
          key: declaration.key,
          handlerKey: declaration.handlerKey,
          cronExpr: declaration.cronExpr,
          timezone: declaration.timezone ?? DEFAULT_TIMEZONE,
          enabled: declaration.enabled ?? true,
          payload: (declaration.payload ?? null) as any,
          createdVia: "declaration",
        },
      });
      this.logger.log(
        `Scheduled job declared: ${declaration.key} (${declaration.cronExpr} ${
          declaration.timezone ?? DEFAULT_TIMEZONE
        })`,
      );
    } catch (error: any) {
      // Concurrent declaration (e.g. another process bootstrapping) won the race.
      if (error?.code !== PG_UNIQUE_VIOLATION) {
        throw error;
      }
    }
  }

  listJobs() {
    return this.prisma.scheduledJob.findMany({ orderBy: { key: "asc" } });
  }

  async listJobRuns(key: string, limitQuery?: string) {
    const job = await this.prisma.scheduledJob.findUnique({ where: { key } });
    if (!job) {
      throw new NotFoundException(`Scheduled job not found: ${key}`);
    }

    const parsedLimit = Number.parseInt(limitQuery ?? "", 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_RUN_LIMIT) : DEFAULT_RUN_LIMIT;

    return this.prisma.scheduledJobRun.findMany({
      where: { jobId: job.id },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  private addCronJob(job: ScheduledJobRecord, cronJobName: string) {
    const cronJob = new CronJob(
      job.cronExpr,
      () => {
        this.executeJob(job, "schedule").catch((error) => {
          this.logger.error(`Scheduled job ${job.key} failed unexpectedly: ${this.getErrorMessage(error)}`);
        });
      },
      null,
      false,
      job.timezone || DEFAULT_TIMEZONE,
    );

    this.schedulerRegistry.addCronJob(cronJobName, cronJob);
    cronJob.start();
    this.logger.log(`Cron job started for scheduled job ${job.key}: ${job.cronExpr} (${job.timezone})`);
  }

  private deleteCronJob(cronJobName: string) {
    try {
      const cronJob = this.schedulerRegistry.getCronJob(cronJobName);
      cronJob.stop();
      this.schedulerRegistry.deleteCronJob(cronJobName);
    } catch (error) {
      // The job was never registered (e.g. invalid cron on a previous reconcile).
    }
  }

  private async executeJob(job: ScheduledJobRecord, trigger: JobTrigger) {
    if (this.runningJobKeys.has(job.key)) {
      this.logger.warn(`Skipping ${trigger} run of scheduled job ${job.key}: previous run is still in progress.`);
      return this.prisma.scheduledJobRun.create({
        data: {
          jobId: job.id,
          trigger,
          status: "skipped",
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 0,
          error: "Previous run is still in progress.",
        },
      });
    }

    this.runningJobKeys.add(job.key);
    const startedAt = new Date();
    const run = await this.prisma.scheduledJobRun.create({
      data: { jobId: job.id, trigger, status: "running", startedAt },
    });

    try {
      const handler: ScheduledHandler | undefined = this.handlerRegistry.getHandler(job.handlerKey);
      if (!handler) {
        throw new Error(`Scheduled handler is not registered: ${job.handlerKey}`);
      }
      await handler(job.payload ?? undefined);

      const finishedAt = new Date();
      return this.prisma.scheduledJobRun.update({
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
      this.logger.error(
        `Scheduled job ${job.key} ${trigger} run failed after ${
          finishedAt.getTime() - startedAt.getTime()
        }ms: ${errorMessage}`,
      );
      return this.prisma.scheduledJobRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          error: errorMessage.slice(0, 2000),
        },
      });
    } finally {
      this.runningJobKeys.delete(job.key);
    }
  }

  private cronJobName(key: string): string {
    return `${CRON_JOB_NAME_PREFIX}${key}`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
