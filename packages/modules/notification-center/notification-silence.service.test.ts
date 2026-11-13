import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { NotificationSilenceService } from "./notification-silence.service";

type SilenceRow = {
  id: string;
  condition: unknown;
  startsAt: Date;
  endsAt: Date;
  comment: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function newSilenceStore(rows: SilenceRow[], attemptsBySilence: Record<string, number> = {}) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const prisma = {
    notificationSilence: {
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.get(where.id)!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
    notificationDeliveryAttempt: {
      count: async ({ where }: { where: { silenceId: string } }) => attemptsBySilence[where.silenceId] ?? 0,
    },
  };
  return { service: new NotificationSilenceService(prisma as never), store };
}

function row(overrides: Partial<SilenceRow> = {}): SilenceRow {
  return {
    id: "s1",
    condition: {},
    startsAt: new Date(Date.now() + 60_000),
    endsAt: new Date(Date.now() + 120_000),
    comment: null,
    createdBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

test("cancelling a scheduled silence collapses both bounds instead of inverting the window (R41-02)", async () => {
  const { service, store } = newSilenceStore([row()]);
  const canceled = await service.cancel("s1");
  const saved = store.get("s1")!;
  assert.equal(saved.startsAt.getTime(), saved.endsAt.getTime());
  assert.ok(saved.endsAt.getTime() <= Date.now());
  assert.equal(canceled.isActive, false);
});

test("cancelling an active silence keeps its original start (R41-02)", async () => {
  const startsAt = new Date(Date.now() - 60_000);
  const { service, store } = newSilenceStore([row({ startsAt, endsAt: new Date(Date.now() + 60_000) })]);
  await service.cancel("s1");
  assert.equal(store.get("s1")!.startsAt.getTime(), startsAt.getTime());
});

test("a silence that already intercepted deliveries cannot rewrite its condition (R41-03)", async () => {
  const { service } = newSilenceStore(
    [row({ startsAt: new Date(Date.now() - 1_000), endsAt: new Date(Date.now() + 60_000) })],
    { s1: 2 },
  );
  await assert.rejects(service.update("s1", { condition: { notificationKeys: ["k"] } }), BadRequestException);
});

test("a silence that already intercepted deliveries cannot move its start (R41-03)", async () => {
  const { service } = newSilenceStore(
    [row({ startsAt: new Date(Date.now() - 1_000), endsAt: new Date(Date.now() + 60_000) })],
    { s1: 2 },
  );
  await assert.rejects(
    service.update("s1", { startsAt: new Date(Date.now() - 5_000).toISOString() }),
    BadRequestException,
  );
});

test("a silence that already intercepted deliveries cannot extend its end (R41-03)", async () => {
  const endsAt = new Date(Date.now() + 60_000);
  const { service } = newSilenceStore([row({ startsAt: new Date(Date.now() - 1_000), endsAt })], { s1: 1 });
  await assert.rejects(
    service.update("s1", { endsAt: new Date(endsAt.getTime() + 60_000).toISOString() }),
    BadRequestException,
  );
});

test("a silence that already intercepted deliveries can be ended earlier (R41-03)", async () => {
  const endsAt = new Date(Date.now() + 60_000);
  const earlier = new Date(Date.now() + 30_000).toISOString();
  const { service, store } = newSilenceStore([row({ startsAt: new Date(Date.now() - 1_000), endsAt })], { s1: 1 });
  await service.update("s1", { endsAt: earlier });
  assert.equal(store.get("s1")!.endsAt.toISOString(), earlier);
});

test("a silence without delivery attempts stays fully editable (R41-03)", async () => {
  const { service, store } = newSilenceStore([row()]);
  await service.update("s1", { condition: { notificationKeys: ["k"] } });
  assert.deepEqual(store.get("s1")!.condition, { notificationKeys: ["k"] });
});
