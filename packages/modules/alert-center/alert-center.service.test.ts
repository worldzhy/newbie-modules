import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { AlertCenterService } from "./alert-center.service";
import { AlertSourceRegistryService } from "./alert-source-registry.service";
import { buildAlertFingerprint } from "./alert-center.constants";

type Row = Record<string, any>;

/** Identity of the single alert the behavior tests drive, as stored in the map. */
const SITE_1 = buildAlertFingerprint({ source: "url-check", alertKey: "site-1" });

function newHarness(options: { pausedUntil?: Date | null } = {}) {
  const alerts = new Map<string, Row>();
  const sourceRows = new Map<string, Row>();
  if (options.pausedUntil !== undefined) {
    sourceRows.set("url-check", {
      key: "url-check",
      repeatMinutes: null,
      notificationPausedUntil: options.pausedUntil,
    });
  }
  const events: Row[] = [];

  const findAlert = (where: Row): Row | null => {
    if (where.fingerprint) {
      return alerts.get(where.fingerprint) ?? null;
    }
    return [...alerts.values()].find((row) => row.id === where.id) ?? null;
  };

  const prisma = {
    alert: {
      findUnique: async ({ where }: any) => findAlert(where),
      create: async ({ data }: any) => {
        const row: Row = {
          id: `alert-${alerts.size + 1}`,
          firstSeenAt: data.firstSeenAt ?? new Date(),
          lastSeenAt: new Date(),
          reminderCount: 0,
          occurrences: 1,
          resolvedAt: null,
          createdAt: new Date(),
          ...data,
        };
        alerts.set(data.fingerprint, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = findAlert(where)!;
        const occurrences =
          data.occurrences && typeof data.occurrences === "object"
            ? row.occurrences + data.occurrences.increment
            : (data.occurrences ?? row.occurrences);
        Object.assign(row, data, { occurrences });
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = [...alerts.values()].find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.state === where.state &&
            candidate.nextNotificationAt <= where.nextNotificationAt.lte,
        );
        if (!row) {
          return { count: 0 };
        }
        const reminderCount = row.reminderCount + (data.reminderCount?.increment ?? 0);
        Object.assign(row, data, { reminderCount });
        return { count: 1 };
      },
      findMany: async ({ where }: any) => {
        const excluded: string[] = where.source?.notIn ?? [];
        return (
          [...alerts.values()]
            .filter((row) => row.state === where.state && row.nextNotificationAt <= where.nextNotificationAt.lte)
            .filter((row) => !excluded.includes(row.source))
            // Real Prisma returns snapshots, so the reminder dispatch must not see
            // the claim's own mutation through a shared reference.
            .map((row) => ({ ...row }))
            .sort((a, b) => a.nextNotificationAt.getTime() - b.nextNotificationAt.getTime())
        );
      },
    },
    alertSource: {
      findUnique: async ({ where }: any) => sourceRows.get(where.key) ?? null,
      findMany: async ({ where }: any = {}) => {
        let rows = [...sourceRows.values()];
        if (where?.key?.in) {
          rows = rows.filter((row) => where.key.in.includes(row.key));
        }
        if (where?.notificationPausedUntil?.gt) {
          const gt: Date = where.notificationPausedUntil.gt;
          rows = rows.filter((row) => row.notificationPausedUntil && row.notificationPausedUntil > gt);
        }
        return rows;
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = sourceRows.get(where.key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { ...create };
        sourceRows.set(where.key, row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        sourceRows.delete(where.key);
        return { count: 1 };
      },
    },
  };

  const registry = new AlertSourceRegistryService();
  registry.register({ key: "url-check", displayName: "URL check", defaultRepeatMinutes: 30 });

  const service = new AlertCenterService(prisma as never, registry, {
    notify: async (event) => {
      events.push(event);
    },
  });

  return { service, prisma, alerts, sourceRows, events };
}

test("raise opens a firing alert and sends the first notification", async () => {
  const { service, events } = newHarness();
  const result = await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(result.state, "firing");
  assert.equal(result.isNew, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].state, "firing");
  assert.equal(events[0].reminderCount, 0);
  assert.equal(events[0].severity, "high");
});

test("raise rejects an unregistered source", async () => {
  const { service } = newHarness();
  await assert.rejects(service.raise({ source: "typo-source", alertKey: "a", severity: "high" }), BadRequestException);
});

test("raise rejects a severity outside the fixed vocabulary", async () => {
  const { service } = newHarness();
  await assert.rejects(
    service.raise({ source: "url-check", alertKey: "a", severity: "urgent" as never }),
    BadRequestException,
  );
});

test("a repeated raise advances occurrences without notifying or resetting the rhythm", async () => {
  const { service, alerts, events } = newHarness();
  const first = await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });
  const dueAt = alerts.get(SITE_1)!.nextNotificationAt;

  const second = await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(second.isNew, false);
  assert.equal(second.id, first.id);
  assert.equal(alerts.get(SITE_1)!.occurrences, 2);
  assert.equal(alerts.get(SITE_1)!.nextNotificationAt, dueAt);
  assert.equal(events.length, 1);
});

test("raise after resolve reopens the lifecycle and notifies again", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });
  await service.resolve({ source: "url-check", alertKey: "site-1" });
  const firstLifecycle = (alerts.get(SITE_1)!.firstSeenAt as Date).getTime();

  // A reopen must advance the lifecycle start: it is the occurrence dimension
  // of the delivery identity, so a stale value would make the notification
  // domain treat this firing as a replay of the first cycle (ADR-065 §3).
  await new Promise((resolve) => setTimeout(resolve, 5));
  const reopened = await service.raise({ source: "url-check", alertKey: "site-1", severity: "critical" });

  assert.equal(reopened.isNew, true);
  assert.equal(alerts.get(SITE_1)!.state, "firing");
  assert.equal(alerts.get(SITE_1)!.occurrences, 1);
  assert.equal(alerts.get(SITE_1)!.resolvedAt, null);
  assert.equal(events.length, 3);
  assert.equal(events[2].severity, "critical");
  assert.equal((events[0].lifecycleStartedAt as Date).getTime(), firstLifecycle);
  assert.equal((events[1].lifecycleStartedAt as Date).getTime(), firstLifecycle);
  assert.equal((events[2].lifecycleStartedAt as Date).getTime(), (alerts.get(SITE_1)!.firstSeenAt as Date).getTime());
  assert.notEqual((events[2].lifecycleStartedAt as Date).getTime(), firstLifecycle);
});

test("resolve closes a firing alert and clears the next reminder", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  const resolved = await service.resolve({ source: "url-check", alertKey: "site-1" });

  assert.ok(resolved);
  assert.equal(alerts.get(SITE_1)!.state, "resolved");
  assert.equal(alerts.get(SITE_1)!.nextNotificationAt, null);
  assert.equal(events[events.length - 1].state, "resolved");
});

test("resolve without an alert returns null and notifies nobody", async () => {
  const { service, events } = newHarness();
  assert.equal(await service.resolve({ source: "url-check", alertKey: "never-raised" }), null);
  assert.equal(events.length, 0);
});

test("resolve is idempotent on an already resolved alert", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });
  await service.resolve({ source: "url-check", alertKey: "site-1" });
  const resolvedAt = alerts.get(SITE_1)!.resolvedAt;

  await service.resolve({ source: "url-check", alertKey: "site-1" });

  assert.equal(alerts.get(SITE_1)!.resolvedAt, resolvedAt);
  assert.equal(events.length, 2);
});

test("a paused source records the alert but keeps it off the wire", async () => {
  const pausedUntil = new Date(Date.now() + 60 * 60_000);
  const { service, alerts, events } = newHarness({ pausedUntil });

  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(events.length, 0);
  const dueAt = alerts.get(SITE_1)!.nextNotificationAt as Date;
  // The first reminder lands after the pause, not inside it.
  assert.ok(dueAt > pausedUntil);
});

test("dispatchDueReminders sends one reminder, advances the rhythm and counts it", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high", repeatIntervalMinutes: 5 });
  const row = alerts.get(SITE_1)!;
  row.nextNotificationAt = new Date(Date.now() - 1000);

  const result = await service.dispatchDueReminders();

  assert.equal(result.dispatched, 1);
  assert.equal(row.reminderCount, 1);
  assert.ok(row.nextNotificationAt > new Date());
  assert.equal(events[events.length - 1].reminderCount, 1);
  assert.equal(events[events.length - 1].state, "firing");
});

test("dispatchDueReminders skips a source that is paused", async () => {
  const pausedUntil = new Date(Date.now() + 60 * 60_000);
  const { service, alerts, events } = newHarness({ pausedUntil });
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });
  alerts.get(SITE_1)!.nextNotificationAt = new Date(Date.now() - 1000);

  const result = await service.dispatchDueReminders();

  assert.equal(result.dispatched, 0);
  assert.equal(events.length, 0);
});

test("dispatchDueReminders does not let paused rows starve an unpaused source", async () => {
  const pausedUntil = new Date(Date.now() + 60 * 60_000);
  const { service, alerts, events } = newHarness({ pausedUntil });
  const dueAt = new Date(Date.now() - 1000);
  const row = (id: string, source: string): Row => ({
    id,
    fingerprint: id,
    source,
    scopeId: null,
    severity: "high",
    labels: {},
    data: null,
    state: "firing",
    repeatIntervalMinutes: 5,
    reminderCount: 0,
    occurrences: 1,
    firstSeenAt: dueAt,
    lastSeenAt: dueAt,
    createdAt: dueAt,
    resolvedAt: null,
    nextNotificationAt: dueAt,
    lastNotificationAt: null,
  });
  // A full page of paused rows older than the only unpaused one.
  for (let index = 0; index < 50; index += 1) {
    alerts.set(`paused-${index}`, row(`paused-${index}`, "url-check"));
  }
  alerts.set("live-1", row("live-1", "heartbeat"));

  const result = await service.dispatchDueReminders({ limit: 50 });

  assert.equal(result.dispatched, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, "heartbeat");
});

test("two concurrent first raises settle on the winner row", async () => {
  const { service, prisma, alerts, events } = newHarness();
  let firstCall = true;
  prisma.alert.create = (async (args: any) => {
    if (firstCall) {
      firstCall = false;
      // The other writer committed first: this insert loses the unique race.
      alerts.set(args.data.fingerprint, {
        id: "alert-winner",
        state: "firing",
        reminderCount: 0,
        occurrences: 1,
        lastSeenAt: new Date(),
        firstSeenAt: new Date(),
        resolvedAt: null,
        createdAt: new Date(),
        ...args.data,
      });
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["fingerprint"] },
      });
    }
    throw new Error("unreachable");
  }) as never;

  const result = await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(result.id, "alert-winner");
  assert.equal(result.isNew, false);
  assert.equal(events.length, 0);
});
