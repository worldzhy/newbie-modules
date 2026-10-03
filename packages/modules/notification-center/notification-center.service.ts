import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CENTER_SETTING_SINGLETON_ID,
  DEFAULT_IN_APP_ENABLED,
  DEFAULT_MINIMUM_SEVERITY,
  DEFAULT_PUSH_ENABLED,
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
import { MessagePushService } from "./services/message-push.service";

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
    private readonly messagePush: MessagePushService,
    private readonly registry: NotificationRegistryService,
  ) {}

  // --- Delivery ------------------------------------------------------------

  /**
   * Produce one notification record from a registered notification. The
   * notification's templates are rendered with `context`, severity is resolved
   * from the override or the notification default, and delivery respects the
   * center minimum-severity floor. Push routing is driven by the notification
   * row's runtime settings, falling back to the center default channel group.
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
      // Explicit per-notification channels take priority over the notification
      // group, which in turn takes priority over the center default group.
      const notificationChannels = await this.prisma.notificationSettingChannel.findMany({
        where: { notificationKey: input.notificationKey },
        select: { channelId: true },
      });
      const explicitChannelIds = notificationChannels.map((link) => link.channelId);
      await this.dispatchPush(explicitChannelIds, setting.channelGroupId, setting.pushEnabled, center, title, detail);
    }

    return { id: recordId, deduplicated, dropped: false };
  }

  private async dispatchPush(
    explicitChannelIds: string[],
    notificationChannelGroupId: string | null,
    notificationPushEnabled: boolean,
    center: { pushEnabled: boolean; channelGroupId: string | null },
    title: string,
    detail: string | null,
  ): Promise<void> {
    if (!notificationPushEnabled || !center.pushEnabled) {
      return;
    }
    const text = detail ? `${title}\n${detail}` : title;
    // 1) Explicit per-notification channels win when at least one is selected.
    if (explicitChannelIds.length > 0) {
      await this.messagePush.dispatchToChannelIds(explicitChannelIds, text);
      return;
    }
    // 2) Otherwise fall back to the notification group, then the center group.
    const channelGroupId = notificationChannelGroupId ?? center.channelGroupId;
    if (!channelGroupId) {
      return;
    }
    await this.messagePush.dispatchToGroup(channelGroupId, text);
  }

  // --- Center settings -----------------------------------------------------

  async getCenterSettings(): Promise<NotificationCenterSettingDto & { availableChannelCount: number | null }> {
    const setting = await this.ensureCenterSetting();
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

  async updateCenterSettings(body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    const setting = await this.ensureCenterSetting();

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

    const updated = await this.prisma.notificationCenterSetting.update({
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
    const setting = await this.ensureCenterSetting();
    if (!setting.pushEnabled || !setting.channelGroupId) {
      throw new BadRequestException("Push is disabled or no message channel group is configured.");
    }
    return this.messagePush.dispatchToGroup(setting.channelGroupId, "Nightwatch 通知中心测试消息：推送通道工作正常。");
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

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.NotificationRecord,
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
