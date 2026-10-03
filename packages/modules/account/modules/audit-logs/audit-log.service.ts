import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GeolocationService } from "@modules/account/helpers/geolocation.service";
import { UAParser } from "ua-parser-js";

/** Well-known audit events for the Account module. */
export enum AuditEvent {
  LOGIN = "auth.login",
  LOGIN_FAILED = "auth.login_failed",
  SIGNUP = "auth.signup",
  PASSWORD_CHANGED = "account.password_changed",
  PASSWORD_RESET = "account.password_reset",
  ROLES_CHANGED = "admin.roles_changed",
  API_KEY_CREATED = "api-key.created",
  API_KEY_DELETED = "api-key.deleted",
  SESSION_REVOKED = "session.revoked",
  MFA_ENABLED = "mfa.enabled",
  MFA_DISABLED = "mfa.disabled",
}

type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
  ) {}

  /**
   * Record a security-relevant event. Fire-and-forget by design: callers await
   * the write, but an audit failure must never break the primary flow, so this
   * method swallows its own errors after logging them.
   */
  async record(
    event: AuditEvent,
    params: {
      userId?: string | null;
      apiKeyId?: number | null;
      organizationId?: string | null;
      detail?: Record<string, unknown>;
    } & AuditContext,
  ): Promise<void> {
    try {
      const location = params.ipAddress ? await this.geolocationService.getLocation(params.ipAddress) : undefined;
      const ua = params.userAgent ? new UAParser(params.userAgent) : undefined;
      await this.prisma.auditLog.create({
        data: {
          event,
          rawEvent: JSON.stringify({ event, ...params.detail }),
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
          userId: params.userId ?? undefined,
          apiKeyId: params.apiKeyId ?? undefined,
          organizationId: params.organizationId ?? undefined,
        },
      });
    } catch (error) {
      // Never let an audit failure break the primary flow.
      console.error("[AuditLogService] failed to record event", event, error);
    }
  }
}
