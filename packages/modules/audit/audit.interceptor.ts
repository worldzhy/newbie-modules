import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { AuditActorType, AuditLogService, AuditResult } from "./audit-log.service";
import { HTTP_AUDIT_SKIP } from "./http-audit-skip.decorator";

type MutatingRequest = Request & { user?: unknown };

/**
 * Global interceptor that records every mutating HTTP request (POST, PUT,
 * PATCH, DELETE) together with its actor and outcome. High-volume machine
 * traffic is excluded: telemetry ingestion and liveness pings have their own
 * stores and would otherwise flood the audit trail.
 *
 * Business events that need richer semantics (before/after diffs, target
 * resource) are recorded explicitly via AuditLogService.record().
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private static readonly MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

  private static readonly METHOD_TO_ACTION: Record<string, string> = {
    POST: "created",
    PUT: "updated",
    PATCH: "updated",
    DELETE: "deleted",
  };

  /**
   * Excluded path prefixes:
   * - /api/v1: web monitoring SDK telemetry ingestion
   * - /heartbeat/ping: agent liveness pings
   */
  private static readonly EXCLUDED_PATH_PREFIXES = ["/api/v1", "/heartbeat/ping"];

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MutatingRequest>();
    if (!AuditInterceptor.MUTATING_METHODS.includes(request.method) || this.isExcluded(request.path)) {
      return next.handle();
    }

    // Routes annotated with @SkipHttpAudit() emit their own business event
    // (for example auth.login) for every outcome, so the generic row is noise.
    const skip = this.reflector.getAllAndOverride<boolean>(HTTP_AUDIT_SKIP, [context.getHandler(), context.getClass()]);
    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.record(request, AuditResult.SUCCESS);
        },
        error: () => {
          void this.record(request, AuditResult.FAILURE);
        },
      }),
    );
  }

  private async record(request: MutatingRequest, result: string): Promise<void> {
    const pathSegments = request.path.split("/").filter(Boolean);
    const resourceType = pathSegments[0];
    const resourceId = this.resolveResourceId(request.params);
    const action = AuditInterceptor.METHOD_TO_ACTION[request.method];
    const actor = this.resolveActor(request.user);
    const routePath = this.resolveRoutePath(request);

    await this.auditLogService.record(`http.${action}`, {
      action,
      resourceType,
      resourceId,
      result,
      actorType: actor?.actorType,
      actorId: actor?.actorId,
      ipAddress: this.resolveIpAddress(request),
      userAgent: request.headers["user-agent"],
      detail: {
        method: request.method,
        path: request.path,
        ...(routePath ? { routePath } : {}),
        ...(Object.keys(request.params).length > 0 ? { params: request.params } : {}),
      },
    });
  }

  private isExcluded(path: string): boolean {
    return AuditInterceptor.EXCLUDED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  private resolveResourceId(params: Request["params"]): string | undefined {
    const entry = Object.entries(params ?? {}).find(
      ([key, value]) => value !== undefined && (key === "id" || key.endsWith("Id")),
    );
    const value = entry?.[1];
    return value === undefined ? undefined : String(value);
  }

  /**
   * Passport attaches the validate() return value as request.user. JWT login
   * supplies AccessTokenParsed ({ userId }); API key auth returns boolean
   * true, in which case the concrete key ID is not available here.
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
