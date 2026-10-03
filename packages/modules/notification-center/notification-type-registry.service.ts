import { Injectable, Logger } from "@nestjs/common";
import { SEVERITIES } from "./notification-center.constants";

/**
 * Shape a business module passes when declaring a notification category at
 * startup. Templates are Handlebars-style: `{{field}}` placeholders are
 * replaced with values from the `context` object passed to notify().
 */
export interface NotificationTypeDeclaration {
  /** Stable unique key, e.g. "security.scan-digest". */
  key: string;
  /** Human-readable name shown in the settings UI. */
  name: string;
  /** Title template, e.g. "{{project}} 新增 {{count}} 个风险". */
  titleTemplate: string;
  /** Optional multi-line detail template. */
  detailTemplate?: string;
  /** Severity applied when notify() does not pass an explicit override. */
  defaultSeverity: (typeof SEVERITIES)[number];
  /** Whether push is on for this type by default. */
  defaultPushEnabled?: boolean;
  /** Optional default message-bot channel group for this type. */
  defaultChannelGroupId?: string;
}

export interface RegisteredNotificationType extends NotificationTypeDeclaration {}

/**
 * In-process registry of notification types declared by business code. This is
 * the code-side counterpart to the database NotificationType rows: it holds
 * the templates and defaults that cannot be safely edited at runtime. The
 * database row (see NotificationTypeService) owns the runtime-editable
 * delivery settings (defaultSeverity, pushEnabled, channelGroupId).
 *
 * Mirrors task-scheduling's HandlerRegistryService: business code registers a
 * stable key at startup, the center dispatches by that key.
 */
@Injectable()
export class NotificationTypeRegistryService {
  private readonly logger = new Logger(NotificationTypeRegistryService.name);
  private readonly types = new Map<string, RegisteredNotificationType>();

  register(declaration: NotificationTypeDeclaration): void {
    if (this.types.has(declaration.key)) {
      throw new Error(`Notification type is already registered: ${declaration.key}`);
    }
    if (!SEVERITIES.includes(declaration.defaultSeverity)) {
      throw new Error(
        `Invalid defaultSeverity for ${declaration.key}: ${declaration.defaultSeverity}. Must be one of ${SEVERITIES.join(", ")}.`,
      );
    }
    this.types.set(declaration.key, { ...declaration });
    this.logger.log(`Notification type registered: ${declaration.key}`);
  }

  get(key: string): RegisteredNotificationType | undefined {
    return this.types.get(key);
  }

  getAll(): RegisteredNotificationType[] {
    return [...this.types.values()];
  }
}
