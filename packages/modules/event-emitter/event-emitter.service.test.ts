import assert from "node:assert/strict";
import { test } from "node:test";

import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EVENT_EMISSION_RETENTION_DAYS, EventEmitterService } from "./event-emitter.service";
import type { EventCatalogService } from "./event-catalog.service";

/**
 * The retention window is a module policy constant (ADR-053): it takes the
 * same value in every deployment, so it follows the code version instead of
 * being declared per environment.
 */

function build(prisma: PrismaService = {} as unknown as PrismaService): EventEmitterService {
  return new EventEmitterService(
    prisma,
    { listenerCount: () => 0 } as unknown as EventEmitter2,
    {} as unknown as EventCatalogService,
  );
}

test("the pruning cut point follows the module retention constant", async () => {
  const deleteManyArgs: { where?: { emittedAt?: { lt?: Date } } }[] = [];
  const prisma = {
    eventEmission: {
      deleteMany: async (args: (typeof deleteManyArgs)[number]) => void deleteManyArgs.push(args),
      create: async () => ({}),
    },
  } as unknown as PrismaService;

  const service = build(prisma);
  await (service as unknown as { record: (key: string, payload: unknown) => Promise<void> }).record("evt.key", {});

  const cutoff = deleteManyArgs[0]?.where?.emittedAt?.lt;
  assert.ok(cutoff instanceof Date, "record() must prune before inserting");
  const ageDays = (Date.now() - cutoff.getTime()) / 86_400_000;
  assert.ok(
    Math.abs(ageDays - EVENT_EMISSION_RETENTION_DAYS) < 0.01,
    `expected a ${EVENT_EMISSION_RETENTION_DAYS}-day cutoff, got ${ageDays}`,
  );
});

test("emission payloads are bounded: long strings are cut and oversized blobs degrade to a preview", async () => {
  const created: { payload?: unknown }[] = [];
  const prisma = {
    eventEmission: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { payload?: unknown } }) => {
        created.push(data);
        return {};
      },
    },
  } as unknown as PrismaService;
  const service = build(prisma);
  const record = (key: string, payload: unknown) =>
    (service as unknown as { record: (key: string, payload: unknown) => Promise<void> }).record(key, payload);

  await record("evt.key", { message: "x".repeat(5_000) });
  const truncated = created[0].payload as { message: string };
  assert.ok(truncated.message.length < 2_100);
  assert.match(truncated.message, /\[truncated\]$/);

  await record("evt.key", {
    blob: "y".repeat(20_000),
    rows: Array.from({ length: 100 }, () => "z".repeat(1_000)),
  });
  assert.deepEqual(Object.keys(created[1].payload as object).sort(), ["preview", "truncated"]);
});
