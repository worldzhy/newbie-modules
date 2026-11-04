import assert from "node:assert/strict";
import { test } from "node:test";

import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EventEmitterService } from "./event-emitter.service";
import type { EventCatalogService } from "./event-catalog.service";

/**
 * The retention window is an explicit per-environment decision (ADR-033): a
 * host that forgets to declare it must fail to boot rather than silently prune
 * events on a guessed number of days.
 */

function build(prisma: PrismaService = {} as unknown as PrismaService): EventEmitterService {
  return new EventEmitterService(
    prisma,
    { listenerCount: () => 0 } as unknown as EventEmitter2,
    {} as unknown as EventCatalogService,
  );
}

test("retention days come from the environment and never fall back (ADR-033)", () => {
  const previous = process.env.EVENT_EMISSION_RETENTION_DAYS;
  try {
    delete process.env.EVENT_EMISSION_RETENTION_DAYS;
    assert.throws(build, /EVENT_EMISSION_RETENTION_DAYS/);
    process.env.EVENT_EMISSION_RETENTION_DAYS = "";
    assert.throws(build, /positive integer/);
    process.env.EVENT_EMISSION_RETENTION_DAYS = "30";
    assert.doesNotThrow(build);
  } finally {
    if (previous === undefined) {
      delete process.env.EVENT_EMISSION_RETENTION_DAYS;
    } else {
      process.env.EVENT_EMISSION_RETENTION_DAYS = previous;
    }
  }
});

test("the pruning cut point follows the configured retention days", async () => {
  process.env.EVENT_EMISSION_RETENTION_DAYS = "45";
  try {
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
    assert.ok(Math.abs(ageDays - 45) < 0.01, `expected a 45-day cutoff, got ${ageDays}`);
  } finally {
    delete process.env.EVENT_EMISSION_RETENTION_DAYS;
  }
});
