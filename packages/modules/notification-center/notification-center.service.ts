import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CENTER_SETTING_SINGLETON_ID,
  DEFAULT_IN_APP_ENABLED,
  DEFAULT_MINIMUM_SEVERITY,
  DEFAULT_PUSH_ENABLED,
  NOTIFICATION_PUSH_PORT,
  PG_UNIQUE_VIOLATION,
  SEVERITIES,
  SEVERITY_LEVEL,
} from "./notification-center.constants";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationCenterSettingDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationCenterSettingDto,
} from "./notification-center.dto";
import { NotificationRegistryService } from "./notification-registry.service";

/**
 * Host-provided push adapter, injected under the NOTIFICATION_PUSH_PORT token.
 * The notification-center module owns in-app delivery and per-notification
 * settings; the actual chat push is supplied by the host application, which
 * knows its chat platform and its system-chat bindings.
 */
export interface NotificationPushPort {
  /**
   * Push a system-scope text message to the host-configured system chats.
   * Returns per-chat delivery counts.
   */
  pushSystemText(text: string): Promise<{ succeeded: number; failed: number }>;
}

export interface NotifyInput {
  /** Key of a registered notification. */
  notificationKey: string;
  /** Values interpolated into the notification's title/detail templates. */
  context?: Record<string, unknown>;
  /** Override the notification's default severity for this delivery. */
  severity?: (typeof SEVERITIES)[number];
  /** Optional project/tenant scope used for filtering. */
  projectId?: string;
  /** Deep-link the frontend opens when the notification is clicked. */
  link?: string;
  /**
   * Optional idempotency key. When provided, a second notify() with the same
   * key is a no-op (the existing record is returned).
   */
  deduplicationKey?: string;
}

export interface NotifyResult {
  /** The created record id, or the existing one when deduplicated. */
  id: string;
  /** True when the deduplication key already existed and no row was created. */
  deduplicated: boolean;
  /** True when the notification was dropped (below minimum severity). */
  dropped: boolean;
}

/**
 * Replace {{key}} placeholders in a template with values from the context.
 * Missing keys render as empty strings so a single template can be reused
 * across callers that provide different context shapes.
 */
function renderTemplate(template: string, context?: Record<string, unknown>): string {
  if (!context) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

@Injectable()
export class NotificationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistryService,
    @Optional()
    @Inject(NOTIFICATION_PUSH_PORT)
    private readonly pushPort?: NotificationPushPort,
  ) {}

  // --- Delivery ------------------------------------------------------------

  /**
   * Produce one notification record from a registered notification. The
   * notification's templates are rendered with `context`, severity is resolved
   * from the override or the notification default, and delivery respects the
   * center minimum-severity floor. System-scope notifications are pushed
   * through the host-provided push port; project-scope push routing is owned
   * by the host (per-project chat bindings) and does not pass through here.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const declared = this.registry.get(input.notificationKey);
    if (!declared) {
      throw new NotFoundException(`Notification is not registered: ${input.notificationKey}`);
    }

    const setting = await this.prisma.notificationSetting.findUnique({ where: { key: input.notificationKey } });
    if (!setting) {
      throw new NotFoundException(`Notification declaration missing in database: ${input.notificationKey}`);
    }

    const severity = input.severity ?? setting.defaultSeverity;
    const center = await this.ensureCenterSetting();

    // Drop deliveries below the center severity floor before any write.
    if (SEVERITY_LEVEL[severity] < (SEVERITY_LEVEL[center.minimumSeverity] ?? SEVERITY_LEVEL.high)) {
      return { id: "", deduplicated: false, dropped: true };
    }

    const title = renderTemplate(declared.titleTemplate, input.context);
    const detail = declared.detailTemplate ? renderTemplate(declared.detailTemplate, input.context) : null;

    const data = {
      notificationKey: input.notificationKey,
      severity,
      title,
      detail,
      payload: (input.context ?? null) as unknown as Prisma.InputJsonValue,
      deduplicationKey: input.deduplicationKey ?? null,
      projectId: input.projectId ?? null,
      link: input.link ?? null,
    };

    let recordId: string;
    let deduplicated = false;

    if (input.deduplicationKey) {
      try {
        const created = await this.prisma.notificationRecord.create({ data, select: { id: true } });
        recordId = created.id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PG_UNIQUE_VIOLATION) {
          const existing = await this.prisma.notificationRecord.findUnique({
            where: { deduplicationKey: input.deduplicationKey },
            select: { id: true },
          });
          recordId = existing?.id ?? "";
          deduplicated = true;
        } else {
          throw error;
        }
      }
    } else {
      const created = await this.prisma.notificationRecord.create({ data, select: { id: true } });
      recordId = created.id;
    }

    if (!deduplicated) {
      await this.dispatchPush(setting.scope, setting.pushEnabled, center, title, detail);
    }

    return { id: recordId, deduplicated, dropped: false };
  }

  private async dispatchPush(
    scope: string,
    notificationPushEnabled: boolean,
    center: { pushEnabled: boolean },
    title: string,
    detail: string | null,
  ): Promise<void> {
    if (!notificationPushEnabled || !center.pushEnabled || !this.pushPort) {
      return;
    }
    // Only system-scope notifications push through the center; project-scope
    // deliveries are routed to the owning project's bound chats by the host.
    if (scope !== "system") {
      return;
    }
    const text = detail ? `${title}\n${detail}` : title;
    await this.pushPort.pushSystemText(text);
  }

  // --- Center settings -----------------------------------------------------

  async getCenterSettings(): Promise<NotificationCenterSettingDto> {
    const setting = await this.ensureCenterSetting();
    return {
      inAppEnabled: setting.inAppEnabled,
      pushEnabled: setting.pushEnabled,
      minimumSeverity: setting.minimumSeverity,
    };
  }

  async updateCenterSettings(body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    const setting = await this.ensureCenterSetting();

    const updated = await this.prisma.notificationCenterSetting.update({
      where: { id: setting.id },
      data: {
        ...(body.inAppEnabled !== undefined ? { inAppEnabled: body.inAppEnabled } : {}),
        ...(body.pushEnabled !== undefined ? { pushEnabled: body.pushEnabled } : {}),
        ...(body.minimumSeverity !== undefined ? { minimumSeverity: body.minimumSeverity } : {}),
      },
    });

    return {
      inAppEnabled: updated.inAppEnabled,
      pushEnabled: updated.pushEnabled,
      minimumSeverity: updated.minimumSeverity,
    };
  }

  async testPush(): Promise<TestPushResultDto> {
    const setting = await this.ensureCenterSetting();
    if (!setting.pushEnabled) {
      throw new BadRequestException("Push is disabled.");
    }
    if (!this.pushPort) {
      throw new BadRequestException("No push adapter is configured by the host application.");
    }
    return this.pushPort.pushSystemText("Notification center test message: the push channel is working.");
  }

  private async ensureCenterSetting() {
    const existing = await this.prisma.notificationCenterSetting.findUnique({
      where: { id: CENTER_SETTING_SINGLETON_ID },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.notificationCenterSetting.create({
      data: {
        id: CENTER_SETTING_SINGLETON_ID,
        inAppEnabled: DEFAULT_IN_APP_ENABLED,
        pushEnabled: DEFAULT_PUSH_ENABLED,
        minimumSeverity: DEFAULT_MINIMUM_SEVERITY,
      },
    });
  }

  // --- Notification reads --------------------------------------------------

  async list(userId: string, query: ListNotificationsRequestDto): Promise<ListNotificationsResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const unreadOnly = query.unreadOnly === "true";
    const notificationKeys = query.notificationKeys
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean);

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.NotificationRecord,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          createdAt: { gte: visibleSince },
          ...(unreadOnly ? { receipts: { none: { userId } } } : {}),
          ...(query.severity ? { severity: query.severity } : {}),
          ...(notificationKeys && notificationKeys.length > 0 ? { notificationKey: { in: notificationKeys } } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
        },
        orderBy: { createdAt: "desc" },
      },
    });

    const readIds = await this.getReadIds(
      userId,
      result.records.map((record) => record.id),
    );
    result.records = result.records.map((record) => ({
      ...record,
      read: readIds.has(record.id),
    }));
    return result as unknown as ListNotificationsResponseDto;
  }

  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const count = await this.prisma.notificationRecord.count({
      where: { createdAt: { gte: visibleSince }, receipts: { none: { userId } } },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<MarkNotificationReadResponseDto> {
    const record = await this.prisma.notificationRecord.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Notification not found: ${id}`);
    }
    await this.prisma.notificationReceipt.upsert({
      where: { userId_notificationId: { userId, notificationId: id } },
      create: { userId, notificationId: id },
      update: {},
    });
    return { read: true };
  }

  async markAllRead(userId: string): Promise<MarkAllNotificationsReadResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const unread = await this.prisma.notificationRecord.findMany({
      where: { createdAt: { gte: visibleSince }, receipts: { none: { userId } } },
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.notificationReceipt.createMany({
        data: unread.map((record) => ({ userId, notificationId: record.id })),
        skipDuplicates: true,
      });
    }
    return { marked: unread.length };
  }

  // --- Internal helpers ----------------------------------------------------

  // Notifications created before the user account existed stay invisible,
  // otherwise newly created users would inherit the whole backlog as unread.
  private async getVisibilityFloor(userId: string): Promise<Date> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    return user?.createdAt ?? new Date(0);
  }

  private async getReadIds(userId: string, notificationIds: string[]): Promise<Set<string>> {
    if (notificationIds.length === 0) {
      return new Set();
    }
    const receipts = await this.prisma.notificationReceipt.findMany({
      where: { userId, notificationId: { in: notificationIds } },
      select: { notificationId: true },
    });
    return new Set(receipts.map((receipt) => receipt.notificationId));
  }
}
