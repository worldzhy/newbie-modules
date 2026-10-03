import { Inject, Logger, OnModuleInit } from "@nestjs/common";
import { NotificationRegistryService } from "./notification-registry.service";
import { SEVERITIES } from "./notification-center.constants";

/**
 * Convenience base class for a platform notification: the subclass declares
 * the notification identity and default delivery settings, and the base class
 * wires registry registration on module init.
 *
 * Platform dependencies are property-injected by the framework so subclasses
 * keep their constructor free of notification boilerplate.
 */
export abstract class Notification implements OnModuleInit {
  protected abstract readonly key: string;
  protected abstract readonly name: string;
  protected abstract readonly titleTemplate: string;
  protected abstract readonly defaultSeverity: (typeof SEVERITIES)[number];
  protected readonly detailTemplate?: string;
  protected readonly defaultPushEnabled?: boolean;
  protected readonly defaultChannelGroupId?: string;
  protected abstract readonly logger: Logger;

  @Inject(NotificationRegistryService)
  protected readonly notificationRegistry!: NotificationRegistryService;

  onModuleInit(): void {
    this.notificationRegistry.register({
      key: this.key,
      name: this.name,
      titleTemplate: this.titleTemplate,
      detailTemplate: this.detailTemplate,
      defaultSeverity: this.defaultSeverity,
      defaultPushEnabled: this.defaultPushEnabled,
      defaultChannelGroupId: this.defaultChannelGroupId,
    });
  }
}
