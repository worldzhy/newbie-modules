import { BadRequestException, Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  DEFAULT_NOTIFICATION_PUSH_ENABLED,
  DEFAULT_NOTIFICATION_SCOPE,
  PG_UNIQUE_VIOLATION,
  SEVERITIES,
} from "./notification-center.constants";
import { NotificationRegistryService } from "./notification-registry.service";

export interface NotificationSettingListItem {
  key: string;
  name: string;
  titleTemplate: string;
  detailTemplate: string | null;
  defaultSeverity: string;
  isPushEnabled: boolean;
  scope: string;
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
   * runtime-edited defaultSeverity / isPushEnabled) are left untouched so
   * operator edits survive restarts.
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
            isPushEnabled: declared.defaultPushEnabled ?? DEFAULT_NOTIFICATION_PUSH_ENABLED,
            scope: declared.scope ?? DEFAULT_NOTIFICATION_SCOPE,
          },
        });
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== PG_UNIQUE_VIOLATION) {
          throw error;
        }
      }
    }
  }

  async listSettings(): Promise<NotificationSettingListItem[]> {
    const rows = await this.prisma.notificationSetting.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      titleTemplate: row.titleTemplate,
      detailTemplate: row.detailTemplate,
      defaultSeverity: row.defaultSeverity,
      isPushEnabled: row.isPushEnabled,
      scope: row.scope,
    }));
  }

  async updateSetting(
    key: string,
    updates: {
      defaultSeverity?: string;
      isPushEnabled?: boolean;
    },
  ): Promise<NotificationSettingListItem> {
    const row = await this.prisma.notificationSetting.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(`Notification setting not found: ${key}`);
    }

    if (updates.defaultSeverity !== undefined && !(SEVERITIES as readonly string[]).includes(updates.defaultSeverity)) {
      throw new BadRequestException(
        `Invalid defaultSeverity: ${updates.defaultSeverity}. Must be one of ${SEVERITIES.join(", ")}.`,
      );
    }

    const updated = await this.prisma.notificationSetting.update({
      where: { key },
      data: {
        ...(updates.defaultSeverity !== undefined ? { defaultSeverity: updates.defaultSeverity } : {}),
        ...(updates.isPushEnabled !== undefined ? { isPushEnabled: updates.isPushEnabled } : {}),
      },
    });

    return {
      key: updated.key,
      name: updated.name,
      titleTemplate: updated.titleTemplate,
      detailTemplate: updated.detailTemplate,
      defaultSeverity: updated.defaultSeverity,
      isPushEnabled: updated.isPushEnabled,
      scope: updated.scope,
    };
  }
}
