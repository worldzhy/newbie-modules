import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { AlertCenterService } from "./alert-center.service";
import { AlertSourceRegistryService } from "./alert-source-registry.service";

type Row = Record<string, any>;

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
      findMany: async ({ where }: any) =>
        [...alerts.values()]
          .filter((row) => row.state === where.state && row.nextNotificationAt <= where.nextNotificationAt.lte)
          .sort((a, b) => a.nextNotificationAt.getTime() - b.nextNotificationAt.getTime()),
    },
    alertSource: {
      findUnique: async ({ where }: any) => sourceRows.get(where.key) ?? null,
      findMany: async ({ where }: any = {}) => {
        const rows = [...sourceRows.values()];
        return where?.key?.in ? rows.filter((row) => where.key.in.includes(row.key)) : rows;
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
  const dueAt = alerts.get("url-check:site-1")!.nextNotificationAt;

  const second = await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(second.isNew, false);
  assert.equal(second.id, first.id);
  assert.equal(alerts.get("url-check:site-1")!.occurrences, 2);
  assert.equal(alerts.get("url-check:site-1")!.nextNotificationAt, dueAt);
  assert.equal(events.length, 1);
});

test("raise after resolve reopens the lifecycle and notifies again", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });
  await service.resolve({ source: "url-check", alertKey: "site-1" });

  const reopened = await service.raise({ source: "url-check", alertKey: "site-1", severity: "critical" });

  assert.equal(reopened.isNew, true);
  assert.equal(alerts.get("url-check:site-1")!.state, "firing");
  assert.equal(alerts.get("url-check:site-1")!.occurrences, 1);
  assert.equal(alerts.get("url-check:site-1")!.resolvedAt, null);
  assert.equal(events.length, 3);
  assert.equal(events[2].severity, "critical");
});

test("resolve closes a firing alert and clears the next reminder", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  const resolved = await service.resolve({ source: "url-check", alertKey: "site-1" });

  assert.ok(resolved);
  assert.equal(alerts.get("url-check:site-1")!.state, "resolved");
  assert.equal(alerts.get("url-check:site-1")!.nextNotificationAt, null);
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
  const resolvedAt = alerts.get("url-check:site-1")!.resolvedAt;

  await service.resolve({ source: "url-check", alertKey: "site-1" });

  assert.equal(alerts.get("url-check:site-1")!.resolvedAt, resolvedAt);
  assert.equal(events.length, 2);
});

test("a paused source records the alert but keeps it off the wire", async () => {
  const pausedUntil = new Date(Date.now() + 60 * 60_000);
  const { service, alerts, events } = newHarness({ pausedUntil });

  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high" });

  assert.equal(events.length, 0);
  const dueAt = alerts.get("url-check:site-1")!.nextNotificationAt as Date;
  // The first reminder lands after the pause, not inside it.
  assert.ok(dueAt > pausedUntil);
});

test("dispatchDueReminders sends one reminder, advances the rhythm and counts it", async () => {
  const { service, alerts, events } = newHarness();
  await service.raise({ source: "url-check", alertKey: "site-1", severity: "high", repeatIntervalMinutes: 5 });
  const row = alerts.get("url-check:site-1")!;
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
  alerts.get("url-check:site-1")!.nextNotificationAt = new Date(Date.now() - 1000);

  const result = await service.dispatchDueReminders();

  assert.equal(result.dispatched, 0);
  assert.equal(events.length, 0);
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
