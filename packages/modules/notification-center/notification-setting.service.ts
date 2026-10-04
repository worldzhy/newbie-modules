import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { DEFAULT_NOTIFICATION_PUSH_ENABLED, PG_UNIQUE_VIOLATION, SEVERITIES } from "./notification-center.constants";
import { NotificationRegistryService } from "./notification-registry.service";

export interface NotificationSettingListItem {
  key: string;
  name: string;
  titleTemplate: string;
  detailTemplate: string | null;
  defaultSeverity: string;
  pushEnabled: boolean;
  channelGroupId: string | null;
  channelIds: string[];
}

/**
 * Database-side declaration lifecycle for notifications. Mirrors
 * job-scheduler's JobSchedulerService.upsertScheduleDeclaration: declarations
 * only create missing rows, never override runtime edits made by operators in
 * the settings UI.
 */
@Injectable()
export class NotificationSettingService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistryService,
  ) {}

  /**
   * Runs after every module has finished its onModuleInit (where consumers
   * register their notifications), so all declared notifications are
   * persisted. Existing rows are left untouched to preserve runtime edits.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileDeclarations();
  }

  /**
   * Persist default settings for every notification registered in memory. Only
   * rows that do not exist yet are created; existing rows (including their
   * runtime-edited defaultSeverity / pushEnabled / channelGroupId) are left
   * untouched so operator edits survive restarts.
   */
  async reconcileDeclarations(): Promise<void> {
    for (const declared of this.registry.getAll()) {
      const existing = await this.prisma.notificationSetting.findUnique({ where: { key: declared.key } });
      if (existing) {
        continue;
      }
      try {
        await this.prisma.notificationSetting.create({
          data: {
            key: declared.key,
            name: declared.name,
            titleTemplate: declared.titleTemplate,
            detailTemplate: declared.detailTemplate ?? null,
            defaultSeverity: declared.defaultSeverity,
            pushEnabled: declared.defaultPushEnabled ?? DEFAULT_NOTIFICATION_PUSH_ENABLED,
            channelGroupId: declared.defaultChannelGroupId ?? null,
          },
        });
      } catch (error: any) {
        if (error?.code !== PG_UNIQUE_VIOLATION) {
          throw error;
        }
      }
    }
  }

  async listSettings(): Promise<NotificationSettingListItem[]> {
    const rows = await this.prisma.notificationSetting.findMany({ orderBy: { name: "asc" } });
    const links = await this.prisma.notificationSettingChannel.findMany();
    const channelIdsByNotification = new Map<string, string[]>();
    for (const link of links) {
      const list = channelIdsByNotification.get(link.notificationKey) ?? [];
      list.push(link.channelId);
      channelIdsByNotification.set(link.notificationKey, list);
    }
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      titleTemplate: row.titleTemplate,
      detailTemplate: row.detailTemplate,
      defaultSeverity: row.defaultSeverity,
      pushEnabled: row.pushEnabled,
      channelGroupId: row.channelGroupId,
      channelIds: channelIdsByNotification.get(row.key) ?? [],
    }));
  }

  async updateSetting(
    key: string,
    updates: {
      defaultSeverity?: string;
      pushEnabled?: boolean;
      channelGroupId?: string | null;
      channelIds?: string[];
    },
  ): Promise<NotificationSettingListItem> {
    const row = await this.prisma.notificationSetting.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(`Notification setting not found: ${key}`);
    }

    if (updates.defaultSeverity !== undefined && !SEVERITIES.includes(updates.defaultSeverity as any)) {
      throw new BadRequestException(
        `Invalid defaultSeverity: ${updates.defaultSeverity}. Must be one of ${SEVERITIES.join(", ")}.`,
      );
    }

    let channelGroupId = row.channelGroupId;
    if (updates.channelGroupId !== undefined) {
      channelGroupId = updates.channelGroupId;
      if (channelGroupId) {
        const group = await this.prisma.messageBotChannelGroup.findUnique({ where: { id: channelGroupId } });
        if (!group) {
          throw new BadRequestException(`Message channel group not found: ${channelGroupId}`);
        }
      }
    }

    // Explicit channel selection is a full replace: validate every id exists,
    // then swap the join rows in one transaction.
    if (updates.channelIds !== undefined) {
      const uniqueIds = [...new Set(updates.channelIds)];
      if (uniqueIds.length > 0) {
        const channels = await this.prisma.messageBotChannel.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true },
        });
        const existingIds = new Set(channels.map((channel) => channel.id));
        const missing = uniqueIds.find((id) => !existingIds.has(id));
        if (missing) {
          throw new BadRequestException(`Message channel not found: ${missing}`);
        }
      }
      await this.prisma.$transaction([
        this.prisma.notificationSettingChannel.deleteMany({ where: { notificationKey: key } }),
        ...(uniqueIds.length > 0
          ? [
              this.prisma.notificationSettingChannel.createMany({
                data: uniqueIds.map((channelId) => ({ notificationKey: key, channelId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    const updated = await this.prisma.notificationSetting.update({
      where: { key },
      data: {
        ...(updates.defaultSeverity !== undefined ? { defaultSeverity: updates.defaultSeverity } : {}),
        ...(updates.pushEnabled !== undefined ? { pushEnabled: updates.pushEnabled } : {}),
        ...(updates.channelGroupId !== undefined ? { channelGroupId } : {}),
      },
    });

    const notificationChannels = await this.prisma.notificationSettingChannel.findMany({
      where: { notificationKey: key },
      select: { channelId: true },
    });

    return {
      key: updated.key,
      name: updated.name,
      titleTemplate: updated.titleTemplate,
      detailTemplate: updated.detailTemplate,
      defaultSeverity: updated.defaultSeverity,
      pushEnabled: updated.pushEnabled,
      channelGroupId: updated.channelGroupId,
      channelIds: notificationChannels.map((link) => link.channelId),
    };
  }
}
