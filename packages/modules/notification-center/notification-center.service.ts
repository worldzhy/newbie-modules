import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CENTER_SETTING_SINGLETON_ID,
  DEFAULT_MINIMUM_SEVERITY,
  DEFAULT_PUSH_ENABLED,
  NOTIFICATION_PUSH_PORT,
  PG_UNIQUE_VIOLATION,
  SEVERITIES,
  SEVERITY_LEVEL,
} from "./notification-center.constants";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationCenterSettingDto,
  NotificationPushFailureDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationCenterSettingDto,
} from "./notification-center.dto";
import { NotificationRegistryService } from "./notification-registry.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

// Upper bound for the unresolved push-failure admin listing (R5-P2-07).
const MAX_UNRESOLVED_PUSH_FAILURES = 200;

// Links stored on a notification are rendered as anchors. Site-relative paths
// and http(s) URLs are the only forms the UI can open safely (R5-P2-02).
// The path checks mirror isSafeInternalPath / isSafeRedirectPath (R34-15):
// browsers normalize "/\evil.com" into "//evil.com", and WHATWG URL parsing
// strips tab/newline/CR, so backslashes and C0 control characters are rejected
// rather than repaired.
function isSafeNotificationLink(link: string): boolean {
  if (link.startsWith("/")) {
    if (link.startsWith("//")) return false;
    if (link.includes("\\")) return false;
    if (/[\u0000-\u001f\u007f]/.test(link)) return false;
    return true;
  }
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Host-provided push adapter, injected under the NOTIFICATION_PUSH_PORT token.
 * The notification-center module owns in-app delivery and per-notification
 * settings; the actual chat push is supplied by the host application, which
 * knows its chat platform and its system-chat bindings.
 */
export interface PushDeliveryResult {
  recipientKey: string;
  success: boolean;
  error?: string;
}

export interface NotificationPushPort {
  /**
   * Push a system-scope text message to the host-configured system chats.
   * Returns per-recipient delivery results so the center can record failures
   * and auto-resolve them on later successes.
   */
  pushSystemText(text: string): Promise<PushDeliveryResult[]>;
}

export interface NotifyInput {
  /** Key of a registered notification. */
  notificationKey: string;
  /** Values interpolated into the notification's title/detail templates. */
  context?: Record<string, unknown>;
  /** Override the notification's default severity for this delivery. */
  severity?: (typeof SEVERITIES)[number];
  /** Optional project/tenant scope used for filtering. */
  projectId?: string;
  /** Deep-link the frontend opens when the notification is clicked. */
  link?: string;
  /**
   * Optional idempotency key. When provided, a second notify() with the same
   * key is a no-op (the existing record is returned).
   */
  deduplicationKey?: string;
  /**
   * Lifecycle phase for alert-style notifications ("firing" | "recovered").
   * Defaults to "firing" (ADR-051).
   */
  status?: "firing" | "recovered";
  /**
   * Recovery timestamp for recovered-phase notifications; defaults to now()
   * when status is "recovered" and this is omitted.
   */
  recoveredAt?: Date;
  /**
   * Project scope resolved by the calling controller for the HTTP delivery
   * endpoint. Internal job callers omit it because they act on behalf of the
   * platform and target projects directly.
   */
  visibleProjectIds?: string[];
}

export interface NotifyResult {
  /** The created record id, or the existing one when deduplicated. */
  id: string;
  /** True when the deduplication key already existed and no row was created. */
  deduplicated: boolean;
  /** True when the delivery was recorded in-app but skipped push (below the center floor). */
  pushSuppressed: boolean;
}

/**
 * Replace {{key}} placeholders in a template with values from the context.
 * Missing keys render as empty strings so a single template can be reused
 * across callers that provide different context shapes.
 */
function renderTemplate(template: string, context?: Record<string, unknown>): string {
  if (!context) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value);
  });
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistryService,
    @Optional()
    @Inject(NOTIFICATION_PUSH_PORT)
    private readonly pushPort?: NotificationPushPort,
  ) {}

  // --- Delivery ------------------------------------------------------------

  /**
   * Produce one notification record from a registered notification. The
   * notification's templates are rendered with `context` and severity is
   * resolved from the override or the notification default. The record is
   * always persisted: the center minimum-severity floor only gates push
   * delivery (the in-app bell is the base layer), so a closure or low-severity
   * signal never disappears while its firing counterpart stays visible.
   * System-scope notifications are pushed through the host-provided push port;
   * project-scope push routing is owned by the host (per-project chat bindings)
   * and reads `pushSuppressed` from the result.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const declared = this.registry.get(input.notificationKey);
    if (!declared) {
      throw new NotFoundException(`Notification is not registered: ${input.notificationKey}`);
    }

    // The HTTP delivery endpoint accepts a client-supplied projectId: it must
    // be the caller's own project, otherwise a permission holder could inject
    // notifications into an unrelated project (R5-P2-02).
    if (input.projectId && input.visibleProjectIds) {
      this.assertProjectVisible(input.visibleProjectIds, input.projectId);
    }
    // Links are rendered as an anchor in the frontend; only site-relative
    // paths and http(s) URLs are allowed so a stored `javascript:` link can
    // never become a click target (R5-P2-02).
    if (input.link && !isSafeNotificationLink(input.link)) {
      throw new BadRequestException(`Notification link scheme is not allowed: ${input.link}`);
    }

    const setting = await this.prisma.notificationSetting.findUnique({ where: { key: input.notificationKey } });
    if (!setting) {
      throw new NotFoundException(`Notification declaration missing in database: ${input.notificationKey}`);
    }

    const severity = input.severity ?? setting.defaultSeverity;
    const center = await this.getOrCreateCenterSetting();

    // The floor gates push only: below-floor deliveries are still recorded so
    // the in-app bell keeps every signal (and every recovery pairing with its
    // firing record).
    const pushSuppressed = SEVERITY_LEVEL[severity] < (SEVERITY_LEVEL[center.minimumSeverity] ?? SEVERITY_LEVEL.high);
    if (pushSuppressed) {
      this.logger.debug(
        `Notification ${input.notificationKey} recorded without push: severity ${severity} is below the configured minimum ${center.minimumSeverity}`,
      );
    }

    // ADR-051: recovered-phase notifications prefer the declaration's recovered
    // template overrides so a recovered alert reads "…recovered" instead of
    // rendering the firing template with a zero count.
    const recovered = input.status === "recovered";
    const titleTemplate = (recovered && declared.recoveredTitleTemplate) || declared.titleTemplate;
    const detailTemplate = (recovered && declared.recoveredDetailTemplate) || declared.detailTemplate;
    const title = renderTemplate(titleTemplate, input.context);
    const detail = detailTemplate ? renderTemplate(detailTemplate, input.context) : null;

    const data = {
      notificationKey: input.notificationKey,
      severity,
      title,
      detail,
      payload: (input.context ?? null) as unknown as Prisma.InputJsonValue,
      deduplicationKey: input.deduplicationKey ?? null,
      projectId: input.projectId ?? null,
      link: input.link ?? null,
      status: input.status ?? "firing",
      recoveredAt: input.status === "recovered" ? (input.recoveredAt ?? new Date()) : null,
    };

    let recordId: string;
    let deduplicated = false;

    if (input.deduplicationKey) {
      try {
        const created = await this.prisma.notificationRecord.create({ data, select: { id: true } });
        recordId = created.id;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PG_UNIQUE_VIOLATION) {
          const existing = await this.prisma.notificationRecord.findUnique({
            where: { deduplicationKey: input.deduplicationKey },
            select: { id: true },
          });
          recordId = existing?.id ?? "";
          deduplicated = true;
        } else {
          throw error;
        }
      }
    } else {
      const created = await this.prisma.notificationRecord.create({ data, select: { id: true } });
      recordId = created.id;
    }

    if (!deduplicated) {
      await this.dispatchPush(setting.scope, setting.isPushEnabled, center, pushSuppressed, title, detail, recordId);
    }

    return { id: recordId, deduplicated, pushSuppressed };
  }

  private async dispatchPush(
    scope: string,
    notificationPushEnabled: boolean,
    center: { isPushEnabled: boolean },
    pushSuppressed: boolean,
    title: string,
    detail: string | null,
    recordId: string,
  ): Promise<void> {
    if (pushSuppressed || !notificationPushEnabled || !center.isPushEnabled || !this.pushPort) {
      return;
    }
    // Only system-scope notifications push through the center; project-scope
    // deliveries are routed to the owning project's bound chats by the host.
    if (scope !== "system") {
      return;
    }
    const text = detail ? `${title}\n${detail}` : title;
    let results: PushDeliveryResult[];
    try {
      results = await this.pushPort.pushSystemText(text);
    } catch (error) {
      // Adapter-level failure (DB down while enumerating bindings, Lark client
      // crash, etc.). The NotificationRecord is already persisted at this
      // point; record a generic failure row so the orphan is visible instead
      // of silently disappearing.
      const message = getErrorMessage(error);
      await this.recordFailure(recordId, "__adapter__", `Push adapter failed: ${message}`);
      return;
    }
    // Per-recipient writes are independent (different recipientKeys, no row
    // conflict). Run in parallel instead of serializing N roundtrips.
    await Promise.all(
      results.map(async (result) => {
        if (!result.success) {
          await this.recordFailure(recordId, result.recipientKey, result.error ?? "unknown error");
        } else {
          await this.resolveFailures(result.recipientKey);
        }
      }),
    );
  }

  // --- Center settings -----------------------------------------------------

  async getCenterSettings(): Promise<NotificationCenterSettingDto> {
    const setting = await this.getOrCreateCenterSetting();
    return {
      isPushEnabled: setting.isPushEnabled,
      minimumSeverity: setting.minimumSeverity,
    };
  }

  async updateCenterSettings(body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    const setting = await this.getOrCreateCenterSetting();

    const updated = await this.prisma.notificationCenterSetting.update({
      where: { id: setting.id },
      data: {
        ...(body.isPushEnabled !== undefined ? { isPushEnabled: body.isPushEnabled } : {}),
        ...(body.minimumSeverity !== undefined ? { minimumSeverity: body.minimumSeverity } : {}),
      },
    });

    return {
      isPushEnabled: updated.isPushEnabled,
      minimumSeverity: updated.minimumSeverity,
    };
  }

  async testPush(): Promise<TestPushResultDto> {
    const setting = await this.getOrCreateCenterSetting();
    if (!setting.isPushEnabled) {
      throw new BadRequestException("Push is disabled.");
    }
    if (!this.pushPort) {
      throw new BadRequestException("No push adapter is configured by the host application.");
    }
    let results: PushDeliveryResult[];
    try {
      results = await this.pushPort.pushSystemText("Notification center test message: the push channel is working.");
    } catch (error) {
      // Adapter-level failure (DB down enumerating bindings, Lark client crash, etc.).
      // Surface it as a single synthetic failure so the diagnostic toast shows
      // something actionable instead of a generic 500. Do NOT persist this row —
      // testPush is a diagnostic tool and its results must not mix with real delivery records.
      const message = getErrorMessage(error);
      return {
        succeeded: 0,
        failed: 1,
        results: [
          {
            recipientKey: "__adapter__",
            success: false,
            error: `Push adapter failed: ${message}`,
          },
        ],
      };
    }
    // Self-heal unresolved failures for any recipient that succeeded in this test.
    // testPush is the user's "I just fixed it — verify" tool, so its successes
    // should wipe stale red-badge rows. Failures are NOT recorded (ephemeral).
    const successfulKeys = results.filter((r) => r.success).map((r) => r.recipientKey);
    await Promise.all(successfulKeys.map((key) => this.resolveFailures(key)));
    return {
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    };
  }

  private async getOrCreateCenterSetting() {
    const existing = await this.prisma.notificationCenterSetting.findUnique({
      where: { id: CENTER_SETTING_SINGLETON_ID },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.notificationCenterSetting.create({
      data: {
        id: CENTER_SETTING_SINGLETON_ID,
        isPushEnabled: DEFAULT_PUSH_ENABLED,
        minimumSeverity: DEFAULT_MINIMUM_SEVERITY,
      },
    });
  }

  // --- Notification reads --------------------------------------------------

  async list(
    userId: string,
    visibleProjectIds: string[],
    query: ListNotificationsRequestDto,
  ): Promise<ListNotificationsResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const projectVisibility = this.buildProjectVisibilityWhere(visibleProjectIds);
    const unreadOnly = query.unreadOnly === "true";
    const notificationKeys = query.notificationKeys
      ?.split(",")
      .map((key) => key.trim())
      .filter(Boolean);

    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.NotificationRecord,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          createdAt: { gte: visibleSince },
          ...projectVisibility,
          ...(unreadOnly ? { receipts: { none: { userId } } } : {}),
          ...(query.severity ? { severity: query.severity } : {}),
          ...(notificationKeys && notificationKeys.length > 0 ? { notificationKey: { in: notificationKeys } } : {}),
          ...(query.projectId ? { projectId: query.projectId } : {}),
        },
        orderBy: { createdAt: "desc" },
      },
    });

    const readIds = await this.getReadIds(
      userId,
      result.records.map((record) => record.id),
    );
    result.records = result.records.map((record) => ({
      ...record,
      read: readIds.has(record.id),
    }));
    return result as unknown as ListNotificationsResponseDto;
  }

  async unreadCount(userId: string, visibleProjectIds: string[]): Promise<UnreadCountResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const count = await this.prisma.notificationRecord.count({
      where: {
        createdAt: { gte: visibleSince },
        ...this.buildProjectVisibilityWhere(visibleProjectIds),
        receipts: { none: { userId } },
      },
    });
    return { count };
  }

  async markRead(userId: string, id: string, visibleProjectIds: string[]): Promise<MarkNotificationReadResponseDto> {
    // Scope the lookup exactly like list/unreadCount: a record outside the
    // caller's visible projects must read as not-found, not be marked read.
    const record = await this.prisma.notificationRecord.findFirst({
      where: { id, ...this.buildProjectVisibilityWhere(visibleProjectIds) },
    });
    if (!record) {
      throw new NotFoundException(`Notification not found: ${id}`);
    }
    await this.prisma.notificationReceipt.upsert({
      where: { userId_notificationId: { userId, notificationId: id } },
      create: { userId, notificationId: id },
      update: {},
    });
    return { read: true };
  }

  async markAllRead(userId: string, visibleProjectIds: string[]): Promise<MarkAllNotificationsReadResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const unread = await this.prisma.notificationRecord.findMany({
      where: {
        createdAt: { gte: visibleSince },
        ...this.buildProjectVisibilityWhere(visibleProjectIds),
        receipts: { none: { userId } },
      },
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.notificationReceipt.createMany({
        data: unread.map((record) => ({ userId, notificationId: record.id })),
        skipDuplicates: true,
      });
    }
    return { marked: unread.length };
  }

  // --- Push failure tracking -------------------------------------------------

  /**
   * Record a push failure for a recipient. Called by the center itself after
   * system-scope pushes, and exposed for hosts to report project-scope push
   * failures.
   */
  async recordFailure(notificationRecordId: string | null, recipientKey: string, error: string): Promise<void> {
    await this.prisma.notificationPushFailure.create({
      data: {
        notificationRecordId,
        recipientKey,
        error: error.slice(0, 1000),
      },
    });
  }

  /**
   * Auto-resolve all historical failures for a recipient when it later succeeds.
   */
  async resolveFailures(recipientKey: string): Promise<void> {
    await this.prisma.notificationPushFailure.updateMany({
      where: { recipientKey, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /**
   * List unresolved push failures with linked notification title when available.
   */
  async listUnresolved(): Promise<NotificationPushFailureDto[]> {
    const failures = await this.prisma.notificationPushFailure.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      // Unresolved failures accumulate forever when a recipient stays broken;
      // this admin view is bounded so the response cannot grow without limit
      // (R5-P2-07).
      take: MAX_UNRESOLVED_PUSH_FAILURES,
      include: { notificationRecord: { select: { title: true } } },
    });
    return failures.map((failure) => ({
      id: failure.id,
      notificationRecordId: failure.notificationRecordId,
      notificationTitle: failure.notificationRecord?.title ?? null,
      recipientKey: failure.recipientKey,
      error: failure.error,
      createdAt: failure.createdAt,
      resolvedAt: failure.resolvedAt,
    }));
  }

  // --- Internal helpers ----------------------------------------------------

  /**
   * Project-scoped rows are visible only to members of that project. System
   * rows (projectId = null) stay platform-wide. The caller's scope is resolved
   * by the controller and passed in; an empty scope keeps only system rows.
   */
  private buildProjectVisibilityWhere(visible: string[]): Prisma.NotificationRecordWhereInput {
    return { OR: [{ projectId: null }, { projectId: { in: visible } }] };
  }

  // Reject a client-supplied projectId that the caller cannot see.
  private assertProjectVisible(visible: string[], projectId: string): void {
    if (visible.includes(projectId)) return;
    throw new ForbiddenException(`Project not visible to the caller: ${projectId}`);
  }

  // Notifications created before the user account existed stay invisible,
  // otherwise newly created users would inherit the whole backlog as unread.
  private async getVisibilityFloor(userId: string): Promise<Date> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
    return user?.createdAt ?? new Date(0);
  }

  private async getReadIds(userId: string, notificationIds: string[]): Promise<Set<string>> {
    if (notificationIds.length === 0) {
      return new Set();
    }
    const receipts = await this.prisma.notificationReceipt.findMany({
      where: { userId, notificationId: { in: notificationIds } },
      select: { notificationId: true },
    });
    return new Set(receipts.map((receipt) => receipt.notificationId));
  }
}
