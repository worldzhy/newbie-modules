import { Injectable, Logger } from "@nestjs/common";
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationScope } from "./notification-center.constants";

/**
 * Shape a business module passes when declaring a notification at startup.
 * Templates are Handlebars-style: `{{field}}` placeholders are replaced with
 * values from the `context` object passed to notify().
 */
export interface NotificationDeclaration {
  /** Stable unique key, e.g. "aws.scan-report". */
  key: string;
  /** Human-readable name shown in the settings UI. */
  name: string;
  /**
   * Alert-kind notifications accept a lifecycle state and may use the recovered
   * templates; event-kind ones are one-shot. Defaults to "event".
   */
  kind?: NotificationKind;
  /** Title template, e.g. "{{project}} added {{count}} risks" (runtime templates may be localized data). */
  titleTemplate: string;
  /** Optional multi-line detail template. */
  detailTemplate?: string;
  /**
   * Template overrides used when notify() is called with `state: "resolved"`
   * on an alert-kind notification (ADR-051 / ADR-065 §6): a resolved message
   * reads "…recovered" instead of rendering the firing template with a zero
   * count. Absent overrides fall back to the base templates.
   */
  recoveredTitleTemplate?: string;
  recoveredDetailTemplate?: string;
  /**
   * Whether push is on for this notification by default. A dedicated resolved
   * declaration must mirror its firing counterpart's switch so an alert and
   * its resolution are either both pushed or both kept in-app (ADR-061).
   */
  defaultPushEnabled?: boolean;
  /**
   * Whether a resolved event is pushed. Declared once and read by both states;
   * defaults to true (ADR-062 §4, ADR-063).
   */
  notifyOnRecovery?: boolean;
  /**
   * Delivery scope: "system" notifications are platform-wide (no owning
   * project) and configured at the top level; "project" notifications are
   * produced by a project and routed to that project's bound chats by the
   * host. Defaults to "project".
   */
  scope?: NotificationScope;
}

export type RegisteredNotification = NotificationDeclaration;

/**
 * In-process registry of notifications declared by business code. This is the
 * code-side counterpart to the database NotificationSetting rows: it holds the
 * templates and defaults that cannot be safely edited at runtime. The database
 * row (see NotificationSettingService) owns the runtime-editable delivery
 * setting (isPushEnabled).
 *
 * Business code typically declares a notification by subclassing the abstract
 * Notification base class, which registers itself here on module init.
 * Mirrors job-scheduler's JobHandlerRegistryService: business code registers a
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
    if (declaration.kind && !(NOTIFICATION_KINDS as readonly string[]).includes(declaration.kind)) {
      throw new Error(
        `Invalid kind for ${declaration.key}: ${declaration.kind}. Must be one of ${NOTIFICATION_KINDS.join(", ")}.`,
      );
    }
    this.notifications.set(declaration.key, { ...declaration, kind: declaration.kind ?? "event" });
    this.logger.log(`Notification registered: ${declaration.key}`);
  }

  get(key: string): RegisteredNotification | undefined {
    return this.notifications.get(key);
  }

  getAll(): RegisteredNotification[] {
    return [...this.notifications.values()];
  }
}
