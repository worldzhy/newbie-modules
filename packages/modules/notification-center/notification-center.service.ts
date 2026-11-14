import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CENTER_SETTING_SINGLETON_ID,
  DEFAULT_PUSH_ENABLED,
  NOTIFICATION_PUSH_PORT,
  PG_UNIQUE_VIOLATION,
  SEVERITIES,
  isNotificationSeverity,
} from "./notification-center.constants";
import type {
  DeliveryDecisionReason,
  DeliveryRuleAction,
  DeliveryRuntimeReason,
  NotificationState,
} from "./notification-center.constants";
import {
  ListNotificationsRequestDto,
  ListNotificationsResponseDto,
  MarkAllNotificationsReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationCenterSettingDto,
  NotificationDeliveryAttemptDto,
  NotificationPushFailureDto,
  TestPushResultDto,
  UnreadCountResponseDto,
  UpdateNotificationCenterSettingDto,
} from "./notification-center.dto";
import { NotificationRegistryService } from "./notification-registry.service";
import type { RegisteredNotification } from "./notification-registry.service";
import { NotificationDeliveryRuleService } from "./notification-delivery-rule.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

// Upper bound for the unresolved push-failure admin listing (R5-P2-07).
const MAX_UNRESOLVED_PUSH_FAILURES = 200;

// Page size for the "mark all read" scan: receipts are written page by page, so
// memory stays flat regardless of the unread count (R44-08).
const MARK_ALL_READ_BATCH_SIZE = 500;

const RETENTION_DAYS_KEY = "modules.notification-center.retentionDays";
// The prune walks every old row, so it runs on the notify path at most once an
// hour instead of once per delivery (R47-04 follows the event-emitter pattern).
const RECORD_PRUNE_INTERVAL_MS = 60 * 60_000;

/// Validates the retention window resolved from the assembler's bare env
/// mapping (ADR-033): a declared positive integer, no built-in fallback.
function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received '${value}'.`);
  }
  return value;
}

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
  /**
   * Severity of this delivery. Required: the producer owns the value and a
   * missing one is a caller defect, not a case for a default (ADR-062).
   */
  severity: (typeof SEVERITIES)[number];
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
   * Lifecycle state of an alert-kind notification (ADR-065 §6). Drives the
   * recovered templates and the `state` label matched by delivery rules.
   * Ignored for event-kind notifications; defaults to "firing".
   */
  state?: NotificationState;
  /** Where this delivery came from (ADR-065): "alert" or "event". */
  sourceType?: string;
  /** Id of the origin object (Alert.id for alert deliveries); no foreign key. */
  sourceRef?: string;
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
  /** Delivery verdict of the alert this event belongs to (ADR-062). */
  decision: DeliveryRuleAction;
  /** Why the verdict came out that way; null only for pre-P1 frozen verdicts. */
  reason: DeliveryDecisionReason | null;
  /**
   * Why a notification the rules allowed to deliver was nonetheless kept
   * in-app (ADR-063); null when the delivery went through (or was deduplicated).
   */
  runtimeReason: DeliveryRuntimeReason | null;
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

/** Human-readable form of a suppress decision, for the debug log. */
function describeSuppression(verdict: { reason: DeliveryDecisionReason | null; ruleId: string | null }): string {
  return verdict.reason === "no-rule-matched"
    ? "no enabled rule matched the event"
    : `rule ${verdict.ruleId} decided suppress`;
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);
  private readonly retentionDays: number;
  private lastPruneAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistryService,
    private readonly deliveryRules: NotificationDeliveryRuleService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(NOTIFICATION_PUSH_PORT)
    private readonly pushPort?: NotificationPushPort,
  ) {
    this.retentionDays = requirePositiveInteger(
      Number(this.config.getOrThrow<string>(RETENTION_DAYS_KEY)),
      RETENTION_DAYS_KEY,
    );
  }

  // --- Delivery ------------------------------------------------------------

  /**
   * Produce one notification record from a registered notification. The
   * notification's templates are rendered with `context`; the record is always
   * persisted, and the delivery decision only gates push, so a suppressed
   * low-severity signal never disappears from the in-app bell.
   *
   * Rules are evaluated per delivery (ADR-065 §6): the alert lives in its own
   * domain, so firing and resolved carry the same severity and the same rule
   * table judges both. The seeded table separates them by state all the same —
   * the recovery rule has no severity floor — so a closure is announced even
   * for a signal that stayed in-app; losing a recovery is worse than an extra
   * one. Each recorded delivery writes one audit attempt. System-scope
   * notifications are pushed through the host-provided push port; project-scope
   * push routing is owned by the host (per-project chat bindings) and reads
   * `decision` from the result.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const declared = this.registry.get(input.notificationKey);
    if (!declared) {
      throw new NotFoundException(`Notification is not registered: ${input.notificationKey}`);
    }

    // Severity is owned by the producer and is required (ADR-062). A missing or
    // unknown value is a caller defect; falling back to a default would let the
    // notification domain define severity again.
    if (!isNotificationSeverity(input.severity)) {
      throw new BadRequestException(`Invalid notification severity: ${String(input.severity)}`);
    }
    const severity = input.severity;

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

    const center = await this.getOrCreateCenterSetting();

    // Lifecycle state (ADR-065 §6). Event-kind notifications have no lifecycle,
    // so a state passed for one is ignored.
    const state: NotificationState = declared.kind === "alert" ? (input.state ?? "firing") : "firing";
    const resolved = state === "resolved";

    const verdict = await this.deliveryRules.evaluate({
      state,
      severity,
      notificationKey: input.notificationKey,
      projectId: input.projectId,
    });
    if (verdict.action === "suppress") {
      this.logger.debug(`Notification ${input.notificationKey} recorded without push: ${describeSuppression(verdict)}`);
    }

    // ADR-051: resolved messages prefer the declaration's recovered template
    // overrides so a recovery reads "…recovered" instead of rendering the
    // firing template with a zero count.
    const titleTemplate = (resolved && declared.recoveredTitleTemplate) || declared.titleTemplate;
    const detailTemplate = (resolved && declared.recoveredDetailTemplate) || declared.detailTemplate;
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
      status: state,
      recoveredAt: resolved ? new Date() : null,
      sourceType: input.sourceType ?? null,
      sourceRef: input.sourceRef ?? null,
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
          // The unique violation proved another writer won the race; if that
          // row is gone by now the result is ambiguous, so report it instead of
          // returning an empty id marked as deduplicated (R39-09).
          if (!existing) {
            throw new ConflictException(
              `Notification ${input.deduplicationKey} was written concurrently and is no longer readable.`,
            );
          }
          recordId = existing.id;
          deduplicated = true;
        } else {
          throw error;
        }
      }
    } else {
      const created = await this.prisma.notificationRecord.create({ data, select: { id: true } });
      recordId = created.id;
    }

    let runtimeReason: DeliveryRuntimeReason | null = null;

    if (!deduplicated) {
      await this.pruneExpiredRecords();
      // ADR-063: the real-time segment runs only when the rules allow delivery.
      // The first matching environment fact wins and is recorded next to the
      // rule decision, so "delivered by the rules but kept in-app" is explainable.
      if (verdict.action === "deliver") {
        runtimeReason = this.resolveRuntime({
          scope: setting.scope,
          notificationPushEnabled: setting.isPushEnabled,
          centerPushEnabled: center.isPushEnabled,
          resolved,
          declaration: declared,
        });
      }
      if (runtimeReason) {
        this.logger.debug(`Notification ${input.notificationKey} kept in-app: ${runtimeReason}`);
      }

      // One audit row per delivery decision (ADR-062/063) so every push,
      // suppression or real-time interception is explainable after the fact.
      await this.prisma.notificationDeliveryAttempt.create({
        data: {
          recordId,
          decision: verdict.action,
          reason: verdict.reason,
          ruleId: verdict.ruleId,
          runtimeReason,
        },
      });
      await this.dispatchPush(setting.scope, verdict.action, runtimeReason, title, detail, recordId);
    }

    return {
      id: recordId,
      deduplicated,
      decision: verdict.action,
      reason: verdict.reason,
      runtimeReason,
    };
  }

  /**
   * Real-time segment of the delivery decision (ADR-063). Environment facts
   * read at delivery time, in fixed order: the first match wins. Only runs
   * when the rule decision is "deliver". Timing windows live in the alert
   * domain now (rhythm and per-source pause); there is no silence reason here.
   */
  private resolveRuntime(input: {
    scope: string;
    notificationPushEnabled: boolean;
    centerPushEnabled: boolean;
    resolved: boolean;
    declaration: RegisteredNotification;
  }): DeliveryRuntimeReason | null {
    if (!input.notificationPushEnabled) {
      return "subscription-off";
    }
    if (input.resolved && input.declaration.notifyOnRecovery === false) {
      return "recovery-opt-out";
    }
    if (!input.centerPushEnabled) {
      return "channel-off";
    }
    // Only system-scope deliveries go through the center's port; project-scope
    // ones are routed by the host, so an absent port is not an interception.
    if (input.scope === "system" && !this.pushPort) {
      return "no-port";
    }
    return null;
  }

  private async dispatchPush(
    scope: string,
    decision: DeliveryRuleAction,
    runtimeReason: DeliveryRuntimeReason | null,
    title: string,
    detail: string | null,
    recordId: string,
  ): Promise<void> {
    if (decision !== "deliver" || runtimeReason !== null) {
      return;
    }
    // Only system-scope notifications push through the center; project-scope
    // deliveries are routed to the owning project's bound chats by the host.
    if (scope !== "system" || !this.pushPort) {
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
    return { isPushEnabled: setting.isPushEnabled };
  }

  async updateCenterSettings(body: UpdateNotificationCenterSettingDto): Promise<NotificationCenterSettingDto> {
    const setting = await this.getOrCreateCenterSetting();

    const updated = await this.prisma.notificationCenterSetting.update({
      where: { id: setting.id },
      data: {
        ...(body.isPushEnabled !== undefined ? { isPushEnabled: body.isPushEnabled } : {}),
      },
    });

    return { isPushEnabled: updated.isPushEnabled };
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
    try {
      return await this.prisma.notificationCenterSetting.create({
        data: {
          id: CENTER_SETTING_SINGLETON_ID,
          isPushEnabled: DEFAULT_PUSH_ENABLED,
        },
      });
    } catch (error) {
      // Two deliveries can race on the first read of the singleton row. The
      // winner's row is the answer; anything else is a real failure (R39-10).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PG_UNIQUE_VIOLATION) {
        const raced = await this.prisma.notificationCenterSetting.findUnique({
          where: { id: CENTER_SETTING_SINGLETON_ID },
        });
        if (raced) {
          return raced;
        }
      }
      throw error;
    }
  }

  // --- Notification reads --------------------------------------------------

  /**
   * Lazy retention, following the event-emitter module: prune on the notify
   * path, throttled in-process so a busy producer does not scan the history on
   * every delivery. Attempts carry no foreign key to the record, so they are
   * deleted explicitly; receipts and push failures cascade with the record.
   */
  private async pruneExpiredRecords(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < RECORD_PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastPruneAt = now;
    const cutoff = new Date(now - this.retentionDays * 24 * 60 * 60_000);
    try {
      const attempts = await this.prisma.notificationDeliveryAttempt.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      const records = await this.prisma.notificationRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (attempts.count > 0 || records.count > 0) {
        this.logger.log(
          `Pruned ${records.count} notification record(s) and ${attempts.count} delivery attempt(s) older than ${this.retentionDays} days.`,
        );
      }
    } catch (error) {
      this.logger.error(`Notification retention prune failed: ${getErrorMessage(error)}`);
    }
  }

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

  /**
   * Mark every unread record the caller can see. The scan is paginated: the
   * earlier single-shot read materialised every unread id before writing, which
   * grew unbounded with the record table. Each page writes its receipts before
   * the next read, so `receipts: none` stops matching them and the loop
   * converges.
   */
  async markAllRead(userId: string, visibleProjectIds: string[]): Promise<MarkAllNotificationsReadResponseDto> {
    const visibleSince = await this.getVisibilityFloor(userId);
    const where = {
      createdAt: { gte: visibleSince },
      ...this.buildProjectVisibilityWhere(visibleProjectIds),
      receipts: { none: { userId } },
    };
    let marked = 0;
    for (;;) {
      const batch = await this.prisma.notificationRecord.findMany({
        where,
        select: { id: true },
        take: MARK_ALL_READ_BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      await this.prisma.notificationReceipt.createMany({
        data: batch.map((record) => ({ userId, notificationId: record.id })),
        skipDuplicates: true,
      });
      marked += batch.length;
      if (batch.length < MARK_ALL_READ_BATCH_SIZE) {
        break;
      }
    }
    return { marked };
  }

  // --- Delivery audit -------------------------------------------------------

  /**
   * The recorded delivery decision of one notification record (ADR-062). The
   * record list stays lean; the detail panel expands this on demand.
   */
  async getDeliveryAttempt(id: string, visibleProjectIds: string[]): Promise<NotificationDeliveryAttemptDto | null> {
    const record = await this.prisma.notificationRecord.findFirst({
      where: { id, ...this.buildProjectVisibilityWhere(visibleProjectIds) },
      select: { id: true },
    });
    if (!record) {
      throw new NotFoundException(`Notification not found: ${id}`);
    }
    const attempt = await this.prisma.notificationDeliveryAttempt.findFirst({
      where: { recordId: id },
      orderBy: { createdAt: "desc" },
      select: { decision: true, reason: true, ruleId: true, runtimeReason: true, createdAt: true },
    });
    return attempt ?? null;
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
