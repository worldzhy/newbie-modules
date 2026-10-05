import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request audit state. The HTTP interceptor opens a context for every
 * mutating request; AuditLogService.record() marks business events inside
 * it. After the request completes the interceptor uses the counter to
 * detect mutating routes that have no business audit coverage.
 */
export type AuditRequestContext = {
  businessEventCount: number;
};

/**
 * Bridges the request lifecycle with audit writes happening deep inside
 * services, without passing the request object through every layer.
 *
 * Audit writes performed outside of an HTTP request (scheduled jobs,
 * startup tasks) simply see no active context and are not tracked.
 */
@Injectable()
export class AuditContextService {
  private readonly storage = new AsyncLocalStorage<AuditRequestContext>();

  /** Run 'fn' inside a fresh per-request audit context. */
  run<T>(fn: () => T): T {
    return this.storage.run({ businessEventCount: 0 }, fn);
  }

  /** The active context, or undefined outside of an audited request. */
  get current(): AuditRequestContext | undefined {
    return this.storage.getStore();
  }

  /** Account for one business audit write within the active request. */
  noteBusinessEvent(): void {
    const context = this.storage.getStore();
    if (context) {
      context.businessEventCount += 1;
    }
  }
}
