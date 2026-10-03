import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { DEFAULT_TYPE_PUSH_ENABLED, PG_UNIQUE_VIOLATION, SEVERITIES } from "./notification-center.constants";
import { NotificationTypeRegistryService } from "./notification-type-registry.service";

export interface NotificationTypeListItem {
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
 * Database-side declaration lifecycle for notification types. Mirrors
 * task-scheduling's TaskSchedulerService.upsertJobDeclaration: declarations
 * only create missing rows, never override runtime edits made by operators in
 * the settings UI.
 */
@Injectable()
export class NotificationTypeService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationTypeRegistryService,
  ) {}

  /**
   * Runs after every module has finished its onModuleInit (where consumers
   * register their types), so all declared types are persisted. Existing rows
   * are left untouched to preserve runtime edits.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileDeclarations();
  }

  /**
   * Persist default settings for every type registered in memory. Only rows
   * that do not exist yet are created; existing rows (including their
   * runtime-edited defaultSeverity / pushEnabled / channelGroupId) are left
   * untouched so operator edits survive restarts.
   */
  async reconcileDeclarations(): Promise<void> {
    for (const declared of this.registry.getAll()) {
      const existing = await this.prisma.notificationType.findUnique({ where: { key: declared.key } });
      if (existing) {
        continue;
      }
      try {
        await this.prisma.notificationType.create({
          data: {
            key: declared.key,
            name: declared.name,
            titleTemplate: declared.titleTemplate,
            detailTemplate: declared.detailTemplate ?? null,
            defaultSeverity: declared.defaultSeverity,
            pushEnabled: declared.defaultPushEnabled ?? DEFAULT_TYPE_PUSH_ENABLED,
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

  async listTypes(): Promise<NotificationTypeListItem[]> {
    const rows = await this.prisma.notificationType.findMany({ orderBy: { name: "asc" } });
    const links = await this.prisma.notificationTypeChannel.findMany();
    const channelIdsByType = new Map<string, string[]>();
    for (const link of links) {
      const list = channelIdsByType.get(link.notificationTypeKey) ?? [];
      list.push(link.channelId);
      channelIdsByType.set(link.notificationTypeKey, list);
    }
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      titleTemplate: row.titleTemplate,
      detailTemplate: row.detailTemplate,
      defaultSeverity: row.defaultSeverity,
      pushEnabled: row.pushEnabled,
      channelGroupId: row.channelGroupId,
      channelIds: channelIdsByType.get(row.key) ?? [],
    }));
  }

  async updateType(
    key: string,
    updates: {
      defaultSeverity?: string;
      pushEnabled?: boolean;
      channelGroupId?: string | null;
      channelIds?: string[];
    },
  ): Promise<NotificationTypeListItem> {
    const row = await this.prisma.notificationType.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(`Notification type not found: ${key}`);
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
        this.prisma.notificationTypeChannel.deleteMany({ where: { notificationTypeKey: key } }),
        ...(uniqueIds.length > 0
          ? [
              this.prisma.notificationTypeChannel.createMany({
                data: uniqueIds.map((channelId) => ({ notificationTypeKey: key, channelId })),
                skipDuplicates: true,
              }),
            ]
          : []),
      ]);
    }

    const updated = await this.prisma.notificationType.update({
      where: { key },
      data: {
        ...(updates.defaultSeverity !== undefined ? { defaultSeverity: updates.defaultSeverity } : {}),
        ...(updates.pushEnabled !== undefined ? { pushEnabled: updates.pushEnabled } : {}),
        ...(updates.channelGroupId !== undefined ? { channelGroupId } : {}),
      },
    });

    const typeChannels = await this.prisma.notificationTypeChannel.findMany({
      where: { notificationTypeKey: key },
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
      channelIds: typeChannels.map((link) => link.channelId),
    };
  }
}
