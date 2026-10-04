import { Injectable, Logger } from "@nestjs/common";

/// Business code registers an in-process job handler under a stable key; the
/// scheduler dispatches a job run to the handler matching `JobSchedule.handlerKey`.
export type JobHandler = (payload?: unknown) => Promise<void>;

@Injectable()
export class JobHandlerRegistryService {
  private readonly logger = new Logger(JobHandlerRegistryService.name);
  private readonly handlers = new Map<string, JobHandler>();

  registerHandler(key: string, handler: JobHandler): void {
    if (this.handlers.has(key)) {
      throw new Error(`Job handler is already registered: ${key}`);
    }
    this.handlers.set(key, handler);
    this.logger.log(`Job handler registered: ${key}`);
  }

  getHandler(key: string): JobHandler | undefined {
    return this.handlers.get(key);
  }
}
