import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { defer, Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AuditActorType, AuditResult } from "./audit-log.service";
import { AuditContextService } from "./audit-context.service";
import { NO_AUDIT_NEEDED } from "./no-audit-needed.decorator";

type TrackedRequest = Request & { user?: unknown };

/**
 * Keeps HTTP request tracing and business audit events separated
 * (Elastic Common Schema: web access log vs. security event).
 *
 * - Every request is emitted as a structured ACCESS LOG line via the Nest
 *   Logger. Access logs describe the transport ("a POST was made"); they
 *   are never written to the audit table.
 * - The audit table only receives explicit business events via
 *   AuditLogService.record(). For mutating requests that complete without
 *   any business event, and which are not annotated @NoAuditNeeded(), the
 *   interceptor reports a coverage gap outside production so missing
 *   audit points surface during development.
 *
 * High-volume machine traffic is excluded from both channels: telemetry
 * ingestion and liveness pings have their own stores.
 */
@Injectable()
export class HttpAccessInterceptor implements NestInterceptor {
  private static readonly MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  /**
   * Excluded path prefixes:
   * - /api/v1: web monitoring SDK telemetry ingestion
   * - /heartbeat/ping: agent liveness pings
   */
  private static readonly EXCLUDED_PATH_PREFIXES = ["/api/v1", "/heartbeat/ping"];

  private readonly logger = new Logger("HttpAccess");

  /** Coverage gaps are reported once per route + outcome per process. */
  private readonly reportedGaps = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly auditContext: AuditContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TrackedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // 'defer' opens the AsyncLocalStorage context at subscription time, so
    // audit writes anywhere in the handler's async chain are tracked.
    return defer(() =>
      this.auditContext.run(() => {
        const startedAt = Date.now();
        return next.handle().pipe(
          tap({
            next: () => {
              this.afterRequest(context, request, response, {
                outcome: AuditResult.SUCCESS,
                statusCode: response.statusCode,
                durationMs: Date.now() - startedAt,
              });
            },
            error: (error: unknown) => {
              this.afterRequest(context, request, response, {
                outcome: AuditResult.FAILURE,
                statusCode: error instanceof HttpException ? error.getStatus() : 500,
                durationMs: Date.now() - startedAt,
              });
            },
          }),
        );
      }),
    );
  }

  private afterRequest(
    context: ExecutionContext,
    request: TrackedRequest,
    _response: Response,
    result: { outcome: string; statusCode: number; durationMs: number },
  ): void {
    if (this.isExcluded(request.path)) {
      return;
    }

    const actor = this.resolveActor(request.user);
    const routePath = this.resolveRoutePath(request);

    this.writeAccessLog(request, result, actor?.actorId, routePath);

    if (
      HttpAccessInterceptor.MUTATING_METHODS.includes(request.method) &&
      !this.isExplicitlyExempt(context) &&
      (this.auditContext.current?.businessEventCount ?? 0) === 0
    ) {
      this.reportCoverageGap(request, result, routePath);
    }
  }

  /** Structured one-line access entry; this is the web access log channel. */
  private writeAccessLog(
    request: TrackedRequest,
    result: { outcome: string; statusCode: number; durationMs: number },
    actorId: string | undefined,
    routePath: string | undefined,
  ): void {
    const entry = {
      channel: "http-access",
      method: request.method,
      path: request.path,
      ...(routePath ? { routePath } : {}),
      statusCode: result.statusCode,
      outcome: result.outcome,
      durationMs: result.durationMs,
      ...(actorId ? { actorId } : {}),
      ipAddress: this.resolveIpAddress(request),
    };
    const line = JSON.stringify(entry);
    if (result.outcome === AuditResult.FAILURE) {
      this.logger.warn(line);
    } else if (HttpAccessInterceptor.MUTATING_METHODS.includes(request.method)) {
      this.logger.log(line);
    } else {
      this.logger.debug(line);
    }
  }

  /**
   * Report a mutating route with no business audit event. Gaps are only
   * surfaced outside production and deduplicated per route and outcome.
   */
  private reportCoverageGap(
    request: TrackedRequest,
    result: { outcome: string; statusCode: number },
    routePath: string | undefined,
  ): void {
    if (process.env.NODE_ENV === "production") {
      return;
    }
    const routeLabel = routePath ?? request.path;
    const dedupeKey = `${request.method} ${routeLabel} ${result.outcome}`;
    if (this.reportedGaps.has(dedupeKey)) {
      return;
    }
    this.reportedGaps.add(dedupeKey);

    this.logger.warn(
      `Audit coverage gap: ${request.method} ${routeLabel} completed (${result.outcome}) without a business audit event. ` +
        'Emit one via AuditLogService.record(), or annotate the route with @NoAuditNeeded("reason") when no security-relevant state changes.',
    );
  }

  private isExplicitlyExempt(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<string | undefined>(NO_AUDIT_NEEDED, [
        context.getHandler(),
        context.getClass(),
      ]) !== undefined
    );
  }

  private isExcluded(path: string): boolean {
    return HttpAccessInterceptor.EXCLUDED_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  }

  /**
   * Passport attaches the validate() return value as request.user. JWT
   * login supplies AccessTokenParsed ({ userId }); API key auth returns
   * boolean true, in which case the concrete key ID is not available here.
   */
  private resolveActor(user: unknown): { actorType: string; actorId?: string } | undefined {
    if (user === true) {
      return { actorType: AuditActorType.API_KEY };
    }
    if (typeof user === "object" && user !== null && "userId" in user) {
      const userId = (user as { userId?: unknown }).userId;
      if (typeof userId === "string") {
        return { actorType: AuditActorType.USER, actorId: userId };
      }
    }
    return undefined;
  }

  private resolveIpAddress(request: Request): string | undefined {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
      return forwardedFor.split(",")[0].trim();
    }
    return request.socket.remoteAddress ?? undefined;
  }

  private resolveRoutePath(request: Request): string | undefined {
    const routePath = (request as Request & { route?: { path?: string | string[] } }).route?.path;
    if (Array.isArray(routePath)) return routePath[0];
    return routePath;
  }
}
