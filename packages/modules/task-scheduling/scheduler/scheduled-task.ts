import { Inject, Logger, OnModuleInit } from "@nestjs/common";
import { TaskSchedulerService } from "./task-scheduler.service";
import { HandlerRegistryService } from "./handler-registry.service";

/**
 * Convenience base class for a scheduled task: the subclass declares the job
 * identity and default schedule, implements `handle`, and the base class
 * wires registration plus job declaration on module init.
 *
 * Platform dependencies are property-injected by the framework so subclasses
 * keep their constructor free of scheduling boilerplate.
 */
export abstract class ScheduledTask implements OnModuleInit {
  protected abstract readonly jobKey: string;
  protected abstract readonly cronExpr: string;
  protected abstract readonly timezone: string;
  protected abstract readonly enabled: boolean;
  protected abstract readonly logger: Logger;

  @Inject(TaskSchedulerService)
  protected readonly taskScheduler!: TaskSchedulerService;

  @Inject(HandlerRegistryService)
  protected readonly handlerRegistry!: HandlerRegistryService;

  async onModuleInit(): Promise<void> {
    this.handlerRegistry.registerHandler(this.jobKey, (payload) => this.handle(payload));
    await this.taskScheduler.upsertJobDeclaration({
      key: this.jobKey,
      handlerKey: this.jobKey,
      cronExpr: this.cronExpr,
      timezone: this.timezone,
      enabled: this.enabled,
    });
  }

  protected abstract handle(payload?: unknown): Promise<void>;
}
