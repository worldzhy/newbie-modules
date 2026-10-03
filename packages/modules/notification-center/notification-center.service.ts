import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  DEFAULT_IN_APP_ENABLED,
  DEFAULT_MINIMUM_SEVERITY,
  DEFAULT_PUSH_ENABLED,
  DEFAULT_SPIKE_BASELINE_DAYS,
  DEFAULT_SPIKE_ENABLED,
  DEFAULT_SPIKE_THRESHOLD,
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
import { MessagePushService } from "./services/message-push.service";

@Injectable()
export class NotificationCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messagePush: MessagePushService,
  ) {}

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
      spikeEnabled: setting.spikeEnabled,
      spikeThreshold: setting.spikeThreshold,
      spikeBaselineDays: setting.spikeBaselineDays,
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
        ...(body.spikeEnabled !== undefined ? { spikeEnabled: body.spikeEnabled } : {}),
        ...(body.spikeThreshold !== undefined ? { spikeThreshold: body.spikeThreshold } : {}),
        ...(body.spikeBaselineDays !== undefined ? { spikeBaselineDays: body.spikeBaselineDays } : {}),
      },
    });

    return {
      inAppEnabled: updated.inAppEnabled,
      pushEnabled: updated.pushEnabled,
      minimumSeverity: updated.minimumSeverity,
      channelGroupId: updated.channelGroupId,
      spikeEnabled: updated.spikeEnabled,
      spikeThreshold: updated.spikeThreshold,
      spikeBaselineDays: updated.spikeBaselineDays,
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
        spikeEnabled: DEFAULT_SPIKE_ENABLED,
        spikeThreshold: DEFAULT_SPIKE_THRESHOLD,
        spikeBaselineDays: DEFAULT_SPIKE_BASELINE_DAYS,
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
