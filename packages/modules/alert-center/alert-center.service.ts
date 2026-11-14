import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";
import {
  ALERT_NOTIFICATION_PORT,
  ALERT_STATES,
  PG_UNIQUE_VIOLATION,
  buildAlertFingerprint,
  isAlertSeverity,
  isNotificationPaused,
  nextNotificationAt,
} from "./alert-center.constants";
import type { AlertNotificationPort, AlertSeverity, AlertState } from "./alert-center.constants";
import { AlertSourceRegistryService } from "./alert-source-registry.service";
import {
  AlertDto,
  AlertSourceDto,
  ListAlertsRequestDto,
  ListAlertsResponseDto,
  UpdateAlertSourceDto,
} from "./alert-center.dto";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface RaiseAlertInput {
  /** Registered producer key, e.g. "url-check". */
  source: string;
  /** Stable key of one alert inside its source, e.g. the checked URL id. */
  alertKey: string;
  /** Opaque scope (project / tenant / platform) owned by the host. */
  scopeId?: string;
  severity: AlertSeverity;
  /** Route and display labels for the notification domain; never used for alert filtering. */
  labels?: Record<string, string>;
  /** Opaque rendering context (url, error text, counts); the module does not interpret it. */
  data?: Record<string, unknown>;
  /** Overrides the source rhythm for this lifecycle. */
  repeatIntervalMinutes?: number;
}

export interface RaiseAlertResult {
  id: string;
  state: AlertState;
  /** True when this call opened a new lifecycle instead of touching a running one. */
  isNew: boolean;
}

export interface ResolveAlertInput {
  source: string;
  alertKey: string;
  scopeId?: string;
  resolvedAt?: Date;
}

interface AlertRow {
  id: string;
  source: string;
  scopeId: string | null;
  severity: string;
  labels: Prisma.JsonValue;
  data: Prisma.JsonValue | null;
  state: string;
  repeatIntervalMinutes: number;
  nextNotificationAt: Date | null;
  lastNotificationAt: Date | null;
  reminderCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrences: number;
  createdAt: Date;
}

function toAlertDto(row: AlertRow): AlertDto {
  return {
    id: row.id,
    source: row.source,
    scopeId: row.scopeId,
    severity: row.severity,
    labels: (row.labels ?? {}) as Record<string, string>,
    data: (row.data ?? null) as Record<string, unknown> | null,
    state: row.state,
    repeatIntervalMinutes: row.repeatIntervalMinutes,
    nextNotificationAt: row.nextNotificationAt,
    lastNotificationAt: row.lastNotificationAt,
    reminderCount: row.reminderCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
    occurrences: row.occurrences,
    createdAt: row.createdAt,
  };
}

/**
 * Alert identity, state machine, reminder rhythm and per-source pause
 * (ADR-065). Alerts are produced by their own producers, never by
 * notification delivery; the notification domain is called through
 * `AlertNotificationPort` after a state change, and the host binds the adapter
 * that maps `(source, state)` to a notification key.
 */
@Injectable()
export class AlertCenterService {
  private readonly logger = new Logger(AlertCenterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: AlertSourceRegistryService,
    @Optional()
    @Inject(ALERT_NOTIFICATION_PORT)
    private readonly notificationPort?: AlertNotificationPort,
  ) {}

  // --- Lifecycle -----------------------------------------------------------

  /**
   * Open or advance one alert lifecycle (ADR-065 §3). A running alert only
   * moves `lastSeenAt` and `occurrences` — the reminder rhythm is not reset by
   * repeated reports, otherwise a flapping probe would silence the alert.
   */
  async raise(input: RaiseAlertInput): Promise<RaiseAlertResult> {
    const source = this.sources.require(input.source);
    if (!isAlertSeverity(input.severity)) {
      throw new BadRequestException(`Invalid alert severity: ${input.severity}`);
    }
    const now = new Date();
    const fingerprint = buildAlertFingerprint(input);
    const sourceState = await this.prisma.alertSource.findUnique({ where: { key: source.key } });
    const repeatMinutes = this.resolveRepeatMinutes(
      input.repeatIntervalMinutes,
      sourceState?.repeatMinutes,
      source.defaultRepeatMinutes,
    );
    const pausedUntil = sourceState?.notificationPausedUntil ?? null;

    let existing = await this.prisma.alert.findUnique({ where: { fingerprint } });
    let created: AlertRow | null = null;

    if (!existing) {
      try {
        created = await this.prisma.alert.create({
          data: {
            fingerprint,
            source: input.source,
            scopeId: input.scopeId ?? null,
            severity: input.severity,
            labels: (input.labels ?? {}) as Prisma.InputJsonValue,
            data: input.data === undefined ? Prisma.DbNull : (input.data as Prisma.InputJsonValue),
            state: "firing",
            repeatIntervalMinutes: repeatMinutes,
            nextNotificationAt: nextNotificationAt(pausedUntil, repeatMinutes, now),
            firstSeenAt: now,
          },
        });
      } catch (error) {
        // Two first reports of one fingerprint can race between the read and the
        // insert; the fingerprint unique index is the arbitration point and the
        // winner's row is the alert to advance (ADR-065 §3).
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === PG_UNIQUE_VIOLATION)) {
          throw error;
        }
        existing = await this.prisma.alert.findUnique({ where: { fingerprint } });
        if (!existing) {
          throw error;
        }
      }
    }

    if (created) {
      await this.deliver(created, 0, pausedUntil, now);
      return { id: created.id, state: "firing", isNew: true };
    }

    const row = existing ?? (await this.prisma.alert.findUnique({ where: { fingerprint } }));
    if (!row) {
      throw new NotFoundException(`Alert disappeared while raising: ${fingerprint}`);
    }

    if (row.state === "resolved") {
      // A firing after a resolved cycle starts a new lifecycle: identity stays,
      // the counters, timestamps and rhythm restart.
      const reopened = await this.prisma.alert.update({
        where: { id: row.id },
        data: {
          state: "firing",
          severity: input.severity,
          scopeId: input.scopeId ?? null,
          labels: (input.labels ?? {}) as Prisma.InputJsonValue,
          data: input.data === undefined ? Prisma.DbNull : (input.data as Prisma.InputJsonValue),
          resolvedAt: null,
          occurrences: 1,
          reminderCount: 0,
          firstSeenAt: now,
          repeatIntervalMinutes: repeatMinutes,
          nextNotificationAt: nextNotificationAt(pausedUntil, repeatMinutes, now),
        },
      });
      await this.deliver(reopened, 0, pausedUntil, now);
      return { id: reopened.id, state: "firing", isNew: true };
    }

    // Still firing: record the new sighting and keep the existing rhythm. The
    // severity stays that of the cycle so the resolved message is judged the
    // same way as the firing one.
    await this.prisma.alert.update({
      where: { id: row.id },
      data: {
        scopeId: input.scopeId ?? row.scopeId,
        labels: (input.labels ?? {}) as Prisma.InputJsonValue,
        data: input.data ? (input.data as Prisma.InputJsonValue) : undefined,
        occurrences: { increment: 1 },
      },
    });
    return { id: row.id, state: "firing", isNew: false };
  }

  /**
   * Close one alert lifecycle. A resolve without an alert is a late recovery:
   * it returns null and logs instead of creating a row, so a producer that
   * restarted cannot fabricate an alert (ADR-065 §3).
   */
  async resolve(input: ResolveAlertInput): Promise<{ id: string } | null> {
    const source = this.sources.require(input.source);
    const fingerprint = buildAlertFingerprint(input);
    const existing = await this.prisma.alert.findUnique({ where: { fingerprint } });
    if (!existing) {
      this.logger.warn(`Resolve arrived without an alert: ${fingerprint}`);
      return null;
    }
    if (existing.state === "resolved") {
      return { id: existing.id };
    }
    const now = new Date();
    const resolved = await this.prisma.alert.update({
      where: { id: existing.id },
      data: { state: "resolved", resolvedAt: input.resolvedAt ?? now, nextNotificationAt: null },
    });
    const sourceState = await this.prisma.alertSource.findUnique({ where: { key: source.key } });
    await this.deliver(resolved, resolved.reminderCount, sourceState?.notificationPausedUntil ?? null, now);
    return { id: resolved.id };
  }

  /**
   * Send the reminders that are due now (ADR-065 §3). Idempotent and safe to
   * run concurrently: each row is claimed with a conditional update before the
   * port is called, so two scans never message the same reminder twice. The
   * module ships no scheduler; the host calls this from its own job runner.
   */
  async dispatchDueReminders(input: { now?: Date; limit?: number } = {}): Promise<{ dispatched: number }> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    // Paused rows are excluded before the limit is applied. Skipping them in the
    // loop instead would let a whole page of paused rows starve every other
    // source until the pause ends.
    const pausedSources = await this.prisma.alertSource.findMany({
      where: { notificationPausedUntil: { gt: now } },
      select: { key: true },
    });
    const pausedKeys = pausedSources.map((row) => row.key);
    const due = await this.prisma.alert.findMany({
      where: {
        state: "firing",
        nextNotificationAt: { lte: now },
        ...(pausedKeys.length > 0 ? { source: { notIn: pausedKeys } } : {}),
      },
      orderBy: { nextNotificationAt: "asc" },
      take: limit,
    });
    if (due.length === 0) {
      return { dispatched: 0 };
    }

    const sourceKeys = [...new Set(due.map((alert) => alert.source))];
    const sourceRows = await this.prisma.alertSource.findMany({ where: { key: { in: sourceKeys } } });
    const pausedBySource = new Map(sourceRows.map((row) => [row.key, row.notificationPausedUntil]));

    let dispatched = 0;
    for (const alert of due) {
      const pausedUntil = pausedBySource.get(alert.source) ?? null;
      if (isNotificationPaused(pausedUntil, now)) {
        continue;
      }
      const claimed = await this.prisma.alert.updateMany({
        where: { id: alert.id, state: "firing", nextNotificationAt: { lte: now } },
        data: {
          lastNotificationAt: now,
          nextNotificationAt: new Date(now.getTime() + alert.repeatIntervalMinutes * 60_000),
          reminderCount: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        continue;
      }
      await this.deliver(
        { ...alert, reminderCount: alert.reminderCount + 1 },
        alert.reminderCount + 1,
        pausedUntil,
        now,
        {
          skipPauseCheck: true,
        },
      );
      dispatched += 1;
    }
    return { dispatched };
  }

  // --- Reads ---------------------------------------------------------------

  async list(query: ListAlertsRequestDto): Promise<ListAlertsResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const state = query.state && (ALERT_STATES as readonly string[]).includes(query.state) ? query.state : undefined;
    const where: Prisma.AlertWhereInput = {
      ...(state ? { state } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.scopeId ? { scopeId: query.scopeId } : {}),
    };
    const rows = await this.prisma.alert.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      records: page.map(toAlertDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(id: string): Promise<AlertDto> {
    const row = await this.prisma.alert.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Alert not found: ${id}`);
    }
    return toAlertDto(row);
  }

  // --- Source settings -----------------------------------------------------

  /**
   * Registered sources merged with their overrides. The registration is the
   * source of truth for names and defaults; the table only carries what an
   * operator changed.
   */
  async listSources(): Promise<AlertSourceDto[]> {
    const rows = await this.prisma.alertSource.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return this.sources.getAll().map((source) => {
      const row = byKey.get(source.key);
      return {
        key: source.key,
        displayName: source.displayName,
        defaultRepeatMinutes: source.defaultRepeatMinutes,
        repeatMinutes: row?.repeatMinutes ?? null,
        effectiveRepeatMinutes: row?.repeatMinutes ?? source.defaultRepeatMinutes,
        notificationPausedUntil: row?.notificationPausedUntil ?? null,
      };
    });
  }

  /**
   * Change one source's rhythm or pause window. `undefined` keeps the current
   * value, `null` clears it and falls back to the registration. A row with
   * nothing to store is deleted, so the table only ever holds real overrides.
   */
  async updateSource(key: string, input: UpdateAlertSourceDto): Promise<AlertSourceDto> {
    const source = this.sources.require(key);
    const existing = await this.prisma.alertSource.findUnique({ where: { key } });

    const repeatMinutes = input.repeatMinutes === undefined ? (existing?.repeatMinutes ?? null) : input.repeatMinutes;
    if (repeatMinutes !== null && (!Number.isInteger(repeatMinutes) || repeatMinutes <= 0)) {
      throw new BadRequestException(`Invalid repeatMinutes: ${repeatMinutes}. Must be a positive integer.`);
    }
    const pausedUntil =
      input.notificationPausedUntil === undefined
        ? (existing?.notificationPausedUntil ?? null)
        : input.notificationPausedUntil === null
          ? null
          : new Date(input.notificationPausedUntil);
    if (pausedUntil && Number.isNaN(pausedUntil.getTime())) {
      throw new BadRequestException("notificationPausedUntil must be a valid date.");
    }

    if (repeatMinutes === null && pausedUntil === null) {
      await this.prisma.alertSource.deleteMany({ where: { key } });
      return {
        key: source.key,
        displayName: source.displayName,
        defaultRepeatMinutes: source.defaultRepeatMinutes,
        repeatMinutes: null,
        effectiveRepeatMinutes: source.defaultRepeatMinutes,
        notificationPausedUntil: null,
      };
    }

    const row = await this.prisma.alertSource.upsert({
      where: { key },
      create: { key, repeatMinutes, notificationPausedUntil: pausedUntil },
      update: { repeatMinutes, notificationPausedUntil: pausedUntil },
    });
    return {
      key: source.key,
      displayName: source.displayName,
      defaultRepeatMinutes: source.defaultRepeatMinutes,
      repeatMinutes: row.repeatMinutes,
      effectiveRepeatMinutes: row.repeatMinutes ?? source.defaultRepeatMinutes,
      notificationPausedUntil: row.notificationPausedUntil,
    };
  }

  // --- Internal ------------------------------------------------------------

  /**
   * Hand one lifecycle event to the notification domain. The alert is already
   * persisted at this point, so a failing adapter is logged and never fails
   * the producer's call.
   */
  private async deliver(
    alert: AlertRow,
    reminderCount: number,
    pausedUntil: Date | null,
    now: Date,
    options: { skipPauseCheck?: boolean } = {},
  ): Promise<void> {
    if (!options.skipPauseCheck && isNotificationPaused(pausedUntil, now)) {
      return;
    }
    if (!this.notificationPort) {
      this.logger.warn(`No alert notification adapter is bound; dropping ${alert.id} (${alert.state}).`);
      return;
    }
    try {
      await this.notificationPort.notify({
        alertId: alert.id,
        // The row id outlives a reopen, so the lifecycle start is what tells the
        // notification domain that this is a new occurrence, not a replay.
        lifecycleStartedAt: alert.firstSeenAt,
        source: alert.source,
        scopeId: alert.scopeId ?? undefined,
        state: alert.state as AlertState,
        severity: alert.severity as AlertSeverity,
        labels: (alert.labels ?? {}) as Record<string, string>,
        data: (alert.data ?? null) as Record<string, unknown> | null,
        reminderCount,
      });
    } catch (error) {
      this.logger.error(`Alert notification adapter failed for ${alert.id}: ${getErrorMessage(error)}`);
    }
  }

  private resolveRepeatMinutes(
    requested: number | undefined,
    override: number | null | undefined,
    fallback: number,
  ): number {
    const minutes = requested ?? override ?? fallback;
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new BadRequestException(`Invalid repeatIntervalMinutes: ${minutes}. Must be a positive integer.`);
    }
    return minutes;
  }
}
