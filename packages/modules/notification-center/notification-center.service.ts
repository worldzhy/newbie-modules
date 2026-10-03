import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  DEFAULT_IN_APP_ENABLED,
  DEFAULT_MINIMUM_SEVERITY,
  DEFAULT_PUSH_ENABLED,
  PG_UNIQUE_VIOLATION,
  SEVERITIES,
  SEVERITY_LEVEL,
  SETTING_SINGLETON_ID,
} from "./notification-center.constants";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationSettingDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationSettingDto,
} from "./notification-center.dto";
import { NotificationTypeRegistryService } from "./notification-type-registry.service";
import { MessagePushService } from "./services/message-push.service";

export interface NotifyInput {
  /** Key of a registered notification type. */
  typeKey: string;
  /** Values interpolated into the type's title/detail templates. */
  context?: Record<string, unknown>;
  /** Override the type's default severity for this delivery. */
  severity?: (typeof SEVERITIES)[number];
  /** Optional project/tenant scope used for filtering. */
  projectId?: string;
  /** Deep-link the frontend opens when the notification is clicked. */
  link?: string;
  /**
   * Optional idempotency key. When provided, a second notify() with the same
   * key is a no-op (the existing notification is returned).
   */
  deduplicationKey?: string;
}

export interface NotifyResult {
  /** The created notification id, or the existing one when deduplicated. */
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
    private readonly messagePush: MessagePushService,
    private readonly typeRegistry: NotificationTypeRegistryService,
  ) {}

  // --- Delivery ------------------------------------------------------------

  /**
   * Produce one notification from a registered type. The type's templates are
   * rendered with `context`, severity is resolved from the override or the
   * type default, and delivery respects the platform minimum-severity floor.
   * Push routing is driven by the type row's runtime settings, falling back to
   * the platform default channel group.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const declared = this.typeRegistry.get(input.typeKey);
    if (!declared) {
      throw new NotFoundException(`Notification type is not registered: ${input.typeKey}`);
    }

    const typeRow = await this.prisma.notificationType.findUnique({ where: { key: input.typeKey } });
    if (!typeRow) {
      throw new NotFoundException(`Notification type declaration missing in database: ${input.typeKey}`);
    }

    const severity = input.severity ?? typeRow.defaultSeverity;
    const platform = await this.ensureSetting();

    // Drop deliveries below the platform severity floor before any write.
    if (SEVERITY_LEVEL[severity] < (SEVERITY_LEVEL[platform.minimumSeverity] ?? SEVERITY_LEVEL.high)) {
      return { id: "", deduplicated: false, dropped: true };
    }

    const title = renderTemplate(declared.titleTemplate, input.context);
    const detail = declared.detailTemplate ? renderTemplate(declared.detailTemplate, input.context) : null;

    const data = {
      typeKey: input.typeKey,
      severity,
      title,
      detail,
      payload: (input.context ?? null) as unknown as Prisma.InputJsonValue,
      deduplicationKey: input.deduplicationKey ?? null,
      projectId: input.projectId ?? null,
      link: input.link ?? null,
    };

    let notificationId: string;
    let deduplicated = false;

    if (input.deduplicationKey) {
      try {
        const created = await this.prisma.notification.create({ data, select: { id: true } });
        notificationId = created.id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PG_UNIQUE_VIOLATION) {
          const existing = await this.prisma.notification.findUnique({
            where: { deduplicationKey: input.deduplicationKey },
            select: { id: true },
          });
          notificationId = existing?.id ?? "";
          deduplicated = true;
        } else {
          throw error;
        }
      }
    } else {
      const created = await this.prisma.notification.create({ data, select: { id: true } });
      notificationId = created.id;
    }

    if (!deduplicated) {
      await this.dispatchPush(typeRow.pushEnabled, typeRow.channelGroupId, platform, title, detail);
    }

    return { id: notificationId, deduplicated, dropped: false };
  }

  private async dispatchPush(
    typePushEnabled: boolean,
    typeChannelGroupId: string | null,
    platform: { pushEnabled: boolean; channelGroupId: string | null },
    title: string,
    detail: string | null,
  ): Promise<void> {
    if (!typePushEnabled || !platform.pushEnabled) {
      return;
    }
    const channelGroupId = typeChannelGroupId ?? platform.channelGroupId;
    if (!channelGroupId) {
      return;
    }
    const text = detail ? `${title}\n${detail}` : title;
    const result = await this.messagePush.dispatchToGroup(channelGroupId, text);
    if (result.failed > 0) {
      // Push failures must never break the caller that produced the notification.
    }
  }

  // --- Settings ------------------------------------------------------------

  async getSettings(): Promise<NotificationSettingDto & { availableChannelCount: number | null }> {
    const setting = await this.ensureSetting();
    const availableChannelCount = setting.channelGroupId
      ? await this.messagePush.countChannels(setting.channelGroupId)
      : null;
    return {
      inAppEnabled: setting.inAppEnabled,
      pushEnabled: setting.pushEnabled,
      minimumSeverity: setting.minimumSeverity,
      channelGroupId: setting.channelGroupId,
      availableChannelCount,
    };
  }

  async updateSettings(body: UpdateNotificationSettingDto): Promise<NotificationSettingDto> {
    const setting = await this.ensureSetting();

    let channelGroupId = setting.channelGroupId;
    if (body.channelGroupId !== undefined) {
      channelGroupId = body.channelGroupId;
      if (channelGroupId) {
        const group = await this.prisma.messageBotChannelGroup.findUnique({ where: { id: channelGroupId } });
        if (!group) {
          throw new BadRequestException(`Message channel group not found: ${channelGroupId}`);
        }
      }
    }

    if (body.pushEnabled && !channelGroupId) {
      throw new BadRequestException("A message channel group is required before push can be enabled.");
    }

    const updated = await this.prisma.notificationSetting.update({
      where: { id: setting.id },
      data: {
        ...(body.inAppEnabled !== undefined ? { inAppEnabled: body.inAppEnabled } : {}),
        ...(body.pushEnabled !== undefined ? { pushEnabled: body.pushEnabled } : {}),
        ...(body.minimumSeverity !== undefined ? { minimumSeverity: body.minimumSeverity } : {}),
        ...(body.channelGroupId !== undefined ? { channelGroupId } : {}),
      },
    });

    return {
      inAppEnabled: updated.inAppEnabled,
      pushEnabled: updated.pushEnabled,
      minimumSeverity: updated.minimumSeverity,
      channelGroupId: updated.channelGroupId,
      availableChannelCount: updated.channelGroupId
        ? await this.messagePush.countChannels(updated.channelGroupId)
        : null,
    };
  }

  async testPush(): Promise<TestPushResultDto> {
    const setting = await this.ensureSetting();
    if (!setting.pushEnabled || !setting.channelGroupId) {
      throw new BadRequestException("Push is disabled or no message channel group is configured.");
    }
    return this.messagePush.dispatchToGroup(setting.channelGroupId, "Nightwatch 通知中心测试消息：推送通道工作正常。");
  }

  private async ensureSetting() {
    const existing = await this.prisma.notificationSetting.findUnique({ where: { id: SETTING_SINGLETON_ID } });
    if (existing) {
      return existing;
    }
    return this.prisma.notificationSetting.create({
      data: {
        id: SETTING_SINGLETON_ID,
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

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Notification,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          createdAt: { gte: visibleSince },
          ...(unreadOnly ? { receipts: { none: { userId } } } : {}),
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
    const count = await this.prisma.notification.count({
      where: { createdAt: { gte: visibleSince }, receipts: { none: { userId } } },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<MarkNotificationReadResponseDto> {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) {
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
    const unread = await this.prisma.notification.findMany({
      where: { createdAt: { gte: visibleSince }, receipts: { none: { userId } } },
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.notificationReceipt.createMany({
        data: unread.map((notification) => ({ userId, notificationId: notification.id })),
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
