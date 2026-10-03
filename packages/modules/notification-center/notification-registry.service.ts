import { Injectable, Logger } from "@nestjs/common";
import { SEVERITIES } from "./notification-center.constants";

/**
 * Shape a business module passes when declaring a notification at startup.
 * Templates are Handlebars-style: `{{field}}` placeholders are replaced with
 * values from the `context` object passed to notify().
 */
export interface NotificationDeclaration {
  /** Stable unique key, e.g. "security.scan-digest". */
  key: string;
  /** Human-readable name shown in the settings UI. */
  name: string;
  /** Title template, e.g. "{{project}} added {{count}} risks" (runtime templates may be localized data). */
  titleTemplate: string;
  /** Optional multi-line detail template. */
  detailTemplate?: string;
  /** Severity applied when notify() does not pass an explicit override. */
  defaultSeverity: (typeof SEVERITIES)[number];
  /** Whether push is on for this notification by default. */
  defaultPushEnabled?: boolean;
  /** Optional default message-bot channel group for this notification. */
  defaultChannelGroupId?: string;
}

export interface RegisteredNotification extends NotificationDeclaration {}

/**
 * In-process registry of notifications declared by business code. This is the
 * code-side counterpart to the database NotificationSetting rows: it holds the
 * templates and defaults that cannot be safely edited at runtime. The database
 * row (see NotificationSettingService) owns the runtime-editable delivery
 * settings (defaultSeverity, pushEnabled, channelGroupId).
 *
 * Business code typically declares a notification by subclassing the abstract
 * Notification base class, which registers itself here on module init.
 * Mirrors job-scheduler's HandlerRegistryService: business code registers a
 * stable key at startup, the center dispatches by that key.
 */
@Injectable()
export class NotificationRegistryService {
  private readonly logger = new Logger(NotificationRegistryService.name);
  private readonly notifications = new Map<string, RegisteredNotification>();

  register(declaration: NotificationDeclaration): void {
    if (this.notifications.has(declaration.key)) {
      throw new Error(`Notification is already registered: ${declaration.key}`);
    }
    if (!SEVERITIES.includes(declaration.defaultSeverity)) {
      throw new Error(
        `Invalid defaultSeverity for ${declaration.key}: ${declaration.defaultSeverity}. Must be one of ${SEVERITIES.join(", ")}.`,
      );
    }
    this.notifications.set(declaration.key, { ...declaration });
    this.logger.log(`Notification registered: ${declaration.key}`);
  }

  get(key: string): RegisteredNotification | undefined {
    return this.notifications.get(key);
  }

  getAll(): RegisteredNotification[] {
    return [...this.notifications.values()];
  }
}
