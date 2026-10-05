import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuditContextService } from "./audit-context.service";

/**
 * Opens the per-request audit context before guards and interceptors run.
 *
 * Opening the context in an interceptor would be too late: authentication
 * guards can legitimately emit business events themselves (for example
 * auth.login_failed when credentials are rejected), and interceptor-based
 * AsyncLocalStorage scopes also exit before RxJS subscribes to the handler.
 * Express dispatches downstream layers synchronously from next(), so every
 * promise created by guards, controllers and services in this request
 * inherits the store, including continuations long after next() returns.
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  constructor(private readonly auditContext: AuditContextService) {}

  use(_request: Request, _response: Response, next: NextFunction): void {
    this.auditContext.run(() => next());
  }
}
