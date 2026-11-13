import { Inject, Logger, OnModuleInit } from "@nestjs/common";
import { NotificationRegistryService } from "./notification-registry.service";
import {
  DEFAULT_NOTIFICATION_SCOPE,
  type NotificationKind,
  type NotificationScope,
} from "./notification-center.constants";

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
  // Alert-kind notifications may carry a lifecycle state and use the recovered
  // templates; plain events stay "event" and ignore both (ADR-065 §6).
  protected readonly kind: NotificationKind = "event";
  // Delivery scope; project-scoped is the common case, system notifications
  // (platform-wide, no owning project) declare "system" explicitly.
  protected readonly scope: NotificationScope = DEFAULT_NOTIFICATION_SCOPE;
  protected readonly detailTemplate?: string;
  /** Optional overrides used when notify() passes state "resolved" for an alert-kind notification. */
  protected readonly recoveredTitleTemplate?: string;
  protected readonly recoveredDetailTemplate?: string;
  protected readonly defaultPushEnabled?: boolean;
  /** Whether resolved events are pushed; defaults to true (ADR-063). */
  protected readonly notifyOnRecovery?: boolean;
  protected abstract readonly logger: Logger;

  @Inject(NotificationRegistryService)
  protected readonly notificationRegistry!: NotificationRegistryService;

  onModuleInit(): void {
    this.notificationRegistry.register({
      key: this.key,
      name: this.name,
      kind: this.kind,
      scope: this.scope,
      titleTemplate: this.titleTemplate,
      detailTemplate: this.detailTemplate,
      recoveredTitleTemplate: this.recoveredTitleTemplate,
      recoveredDetailTemplate: this.recoveredDetailTemplate,
      defaultPushEnabled: this.defaultPushEnabled,
      notifyOnRecovery: this.notifyOnRecovery,
    });
  }
}
