import { Inject, Logger, OnModuleInit } from "@nestjs/common";
import { DEFAULT_TIMEZONE, JobSchedulerService } from "./job-scheduler.service";
import { JobHandlerRegistryService } from "./handler-registry.service";

/**
 * Convenience base class for a scheduled job: the subclass declares the job
 * identity and default schedule, implements `handle`, and the base class
 * wires handler registration plus schedule declaration on module init.
 *
 * Platform dependencies are property-injected by the framework so subclasses
 * keep their constructor free of scheduling boilerplate.
 */
export abstract class ScheduledJob implements OnModuleInit {
  protected abstract readonly key: string;
  /// Optional override; defaults to the platform timezone when not declared.
  protected readonly timezone: string = DEFAULT_TIMEZONE;
  protected abstract readonly cronExpr: string;
  protected abstract readonly enabled: boolean;
  protected abstract readonly logger: Logger;

  @Inject(JobSchedulerService)
  protected readonly jobScheduler!: JobSchedulerService;

  @Inject(JobHandlerRegistryService)
  protected readonly jobHandlerRegistry!: JobHandlerRegistryService;

  async onModuleInit(): Promise<void> {
    this.jobHandlerRegistry.registerHandler(this.key, (payload) => this.handle(payload));
    await this.jobScheduler.upsertScheduleDeclaration({
      key: this.key,
      name: this.name,
      handlerKey: this.key,
      cronExpr: this.cronExpr,
      timezone: this.timezone,
      enabled: this.enabled,
    });
  }

  protected abstract handle(payload?: unknown): Promise<void>;
}
