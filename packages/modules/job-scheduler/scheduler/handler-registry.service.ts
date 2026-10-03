import { Injectable, Logger } from "@nestjs/common";

/// Business code registers an in-process handler under a stable key; the
/// scheduler dispatches a job run to the handler matching `ScheduledJob.handlerKey`.
export type ScheduledHandler = (payload?: unknown) => Promise<void>;

@Injectable()
export class HandlerRegistryService {
  private readonly logger = new Logger(HandlerRegistryService.name);
  private readonly handlers = new Map<string, ScheduledHandler>();

  registerHandler(key: string, handler: ScheduledHandler): void {
    if (this.handlers.has(key)) {
      throw new Error(`Scheduled handler is already registered: ${key}`);
    }
    this.handlers.set(key, handler);
    this.logger.log(`Scheduled handler registered: ${key}`);
  }

  getHandler(key: string): ScheduledHandler | undefined {
    return this.handlers.get(key);
  }
}
