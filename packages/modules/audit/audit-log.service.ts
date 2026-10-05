import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { UAParser } from "ua-parser-js";
import { GeolocationService } from "./helpers/geolocation.service";
import { AuditContextService } from "./audit-context.service";
import { AuditLogQueryDto } from "./audit-log.dto";

/** Kind of identity an audit row is attributed to. */
export const AuditActorType = {
  USER: "user",
  API_KEY: "api-key",
  SYSTEM: "system",
} as const;

/** Outcome of the audited operation. */
export const AuditResult = {
  SUCCESS: "success",
  FAILURE: "failure",
} as const;

/**
 * Well-known audit events. This is an open set: domain modules may define and
 * emit their own event strings using the same "domain.action" convention.
 */
export const AuditEvent = {
  LOGIN: "auth.login",
  LOGIN_FAILED: "auth.login_failed",
  SIGNUP: "auth.signup",
  PASSWORD_CHANGED: "account.password_changed",
  PASSWORD_RESET: "account.password_reset",
  ROLES_CHANGED: "admin.roles_changed",
  API_KEY_CREATED: "api-key.created",
  API_KEY_DELETED: "api-key.deleted",
  SESSION_REVOKED: "session.revoked",
  MFA_ENABLED: "mfa.enabled",
  MFA_DISABLED: "mfa.disabled",
} as const;

export type AuditLogRecordParams = {
  actorType?: string;
  actorId?: string | null;
  organizationId?: string | null;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  /**
   * Detail payload keys searched by 'keyword'. Postgres JSON substring
   * filters require an explicit path, so only known string fields are
   * covered; new event emitters that introduce searchable text should add
   * the key here.
   */
  private static readonly KEYWORD_DETAIL_KEYS = ["reason", "account", "channel", "provider", "description"];

  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
    private readonly auditContext: AuditContextService,
  ) {}

  /**
   * Record a security-relevant event. Fire-and-forget by design: callers may
   * await the write, but an audit failure must never break the primary flow,
   * so this method swallows its own errors after logging them.
   */
  async record(event: string, params: AuditLogRecordParams): Promise<void> {
    // Mark coverage as soon as the write is attempted: a route that calls
    // record() is audited even if this particular write ultimately fails
    // (the failure itself is logged below).
    this.auditContext.noteBusinessEvent();
    try {
      const location = params.ipAddress ? await this.geolocationService.getLocation(params.ipAddress) : undefined;
      const ua = params.userAgent ? new UAParser(params.userAgent) : undefined;
      await this.prisma.auditLog.create({
        data: {
          event,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          result: params.result ?? AuditResult.SUCCESS,
          detail: params.detail as Prisma.InputJsonValue,
          actorType: params.actorType,
          actorId: params.actorId ?? undefined,
          organizationId: params.organizationId ?? undefined,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          city: location?.city?.names?.en,
          region: location?.subdivisions?.pop()?.names?.en,
          timezone: location?.location?.time_zone,
          countryCode: location?.country?.iso_code,
          browser: ua
            ? `${ua.getBrowser().name ?? ""} ${ua.getBrowser().version ?? ""}`.trim() || undefined
            : undefined,
          operatingSystem: ua
            ? `${ua.getOS().name ?? ""} ${ua.getOS().version ?? ""}`.replace("Mac OS", "macOS").trim() || undefined
            : undefined,
        },
      });
    } catch (error) {
      // Never let an audit failure break the primary flow.
      this.logger.error(`Failed to record audit event '${event}': ${String(error)}`);
    }
  }

  /** Query audit logs within an organization or for a single actor. */
  async findMany(scope: { organizationId?: string; actorId?: string }, query: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...scope,
      ...(query.event ? { event: query.event } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.startTime || query.endTime
        ? {
            createdAt: {
              ...(query.startTime ? { gte: new Date(query.startTime) } : {}),
              ...(query.endTime ? { lte: new Date(query.endTime) } : {}),
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { event: { contains: query.keyword, mode: "insensitive" } },
              { resourceId: { contains: query.keyword, mode: "insensitive" } },
              ...AuditLogService.KEYWORD_DETAIL_KEYS.map((key) => ({
                detail: { path: [key], string_contains: query.keyword as string },
              })),
            ],
          }
        : {}),
    };

    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.AuditLog,
      pagination: { page: query.page ?? 0, pageSize: query.pageSize ?? 20 },
      findManyArgs: { where, orderBy: { id: "desc" } },
    });
  }
}
