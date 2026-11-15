import { Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { DEFAULT_NOTIFICATION_PUSH_ENABLED, DEFAULT_NOTIFICATION_SCOPE } from "./notification-center.constants";
import { NotificationRegistryService } from "./notification-registry.service";

export interface NotificationSettingListItem {
  key: string;
  name: string;
  titleTemplate: string;
  detailTemplate: string | null;
  isPushEnabled: boolean;
  scope: string;
}

/**
 * Database-side declaration lifecycle for notifications. Mirrors
 * job-scheduler's JobSchedulerService.upsertScheduleDeclaration: the fields
 * owned by the code declaration are realigned on every start, while the
 * operator-owned `isPushEnabled` is never overridden. Severity is not part of
 * the row: it belongs to the producer and is passed on every notify()
 * (ADR-062 "severity contract").
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
   * persisted and their declaration-owned fields are up to date.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileDeclarations();
  }

  /**
   * Align the declaration-owned fields (`name`, `titleTemplate`,
   * `detailTemplate`, `scope`) of every registered notification with the code
   * declaration on each start, so edits to a declaration stop showing stale
   * text in the settings page. `isPushEnabled` is operator-owned: it is written
   * only when the row is created, so runtime edits survive restarts (R44-10).
   */
  async reconcileDeclarations(): Promise<void> {
    for (const declared of this.registry.getAll()) {
      const fields = {
        name: declared.name,
        titleTemplate: declared.titleTemplate,
        detailTemplate: declared.detailTemplate ?? null,
        scope: declared.scope ?? DEFAULT_NOTIFICATION_SCOPE,
      };
      // Upsert compiles to INSERT ... ON CONFLICT DO UPDATE, so concurrent
      // instances converge on the same row without racing the unique key.
      await this.prisma.notificationSetting.upsert({
        where: { key: declared.key },
        create: {
          key: declared.key,
          ...fields,
          isPushEnabled: declared.defaultPushEnabled ?? DEFAULT_NOTIFICATION_PUSH_ENABLED,
        },
        update: fields,
      });
    }
  }

  async listSettings(): Promise<NotificationSettingListItem[]> {
    const rows = await this.prisma.notificationSetting.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      titleTemplate: row.titleTemplate,
      detailTemplate: row.detailTemplate,
      isPushEnabled: row.isPushEnabled,
      scope: row.scope,
    }));
  }

  async updateSetting(
    key: string,
    updates: {
      isPushEnabled?: boolean;
    },
  ): Promise<NotificationSettingListItem> {
    const row = await this.prisma.notificationSetting.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException(`Notification setting not found: ${key}`);
    }

    const updated = await this.prisma.notificationSetting.update({
      where: { key },
      data: {
        ...(updates.isPushEnabled !== undefined ? { isPushEnabled: updates.isPushEnabled } : {}),
      },
    });

    return {
      key: updated.key,
      name: updated.name,
      titleTemplate: updated.titleTemplate,
      detailTemplate: updated.detailTemplate,
      isPushEnabled: updated.isPushEnabled,
      scope: updated.scope,
    };
  }
}
