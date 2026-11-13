import { Injectable, Logger } from "@nestjs/common";
import { SEVERITIES, type NotificationScope } from "./notification-center.constants";

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
  /** Title template, e.g. "{{project}} added {{count}} risks" (runtime templates may be localized data). */
  titleTemplate: string;
  /** Optional multi-line detail template. */
  detailTemplate?: string;
  /**
   * Lifecycle-phase template overrides (ADR-051): when notify() is called with
   * `status: "recovered"`, these replace titleTemplate/detailTemplate so a
   * recovered alert reads "…recovered" instead of rendering the firing
   * template with a zero count. Absent overrides fall back to the base
   * templates.
   */
  recoveredTitleTemplate?: string;
  recoveredDetailTemplate?: string;
  /**
   * Key of the firing notification this declaration closes, set on dedicated
   * recovered declarations. Recovery carries no alert level of its own, so the
   * center evaluates the floor against this firing declaration's severity and
   * an alert and its recovery always land on the same side of it (ADR-061).
   */
  recoveryOf?: string;
  /**
   * Severity applied when notify() does not pass an explicit override. On a
   * dedicated recovered declaration this is a placeholder ("low"): recovery has
   * no alert level and the floor is evaluated against recoveryOf's severity
   * instead (ADR-061).
   */
  defaultSeverity: (typeof SEVERITIES)[number];
  /**
   * Whether push is on for this notification by default. A dedicated recovered
   * declaration must mirror its firing counterpart's switch so an alert and
   * its recovery are either both pushed or both kept in-app (ADR-061).
   */
  defaultPushEnabled?: boolean;
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
 * settings (defaultSeverity, isPushEnabled).
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
