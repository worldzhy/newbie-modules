import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigService } from "@nestjs/config";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EventEmitterService } from "./event-emitter.service";
import type { EventCatalogService } from "./event-catalog.service";

/**
 * The retention window is an explicit per-environment decision (ADR-033): a
 * host that forgets to declare it must fail to boot rather than silently prune
 * events on a guessed number of days.
 */

const RETENTION_DAYS_KEY = "modules.event-emitter.retentionDays";

function configReturning(retentionDays: unknown): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === RETENTION_DAYS_KEY) return retentionDays;
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

function build(
  prisma: PrismaService = {} as unknown as PrismaService,
  config: ConfigService = configReturning(30),
): EventEmitterService {
  return new EventEmitterService(
    prisma,
    { listenerCount: () => 0 } as unknown as EventEmitter2,
    {} as unknown as EventCatalogService,
    config,
  );
}

test("retention days come from the declared config and never fall back (ADR-033)", () => {
  assert.throws(() => build(undefined, configReturning(undefined)), new RegExp(RETENTION_DAYS_KEY));
  assert.throws(() => build(undefined, configReturning(0)), /positive integer/);
  assert.throws(() => build(undefined, configReturning(-3)), /positive integer/);
  assert.throws(() => build(undefined, configReturning(4.5)), /positive integer/);
  assert.doesNotThrow(() => build(undefined, configReturning(30)));
});

test("the pruning cut point follows the configured retention days", async () => {
  const deleteManyArgs: { where?: { emittedAt?: { lt?: Date } } }[] = [];
  const prisma = {
    eventEmission: {
      deleteMany: async (args: (typeof deleteManyArgs)[number]) => void deleteManyArgs.push(args),
      create: async () => ({}),
    },
  } as unknown as PrismaService;

  const service = build(prisma, configReturning(45));
  await (service as unknown as { record: (key: string, payload: unknown) => Promise<void> }).record("evt.key", {});

  const cutoff = deleteManyArgs[0]?.where?.emittedAt?.lt;
  assert.ok(cutoff instanceof Date, "record() must prune before inserting");
  const ageDays = (Date.now() - cutoff.getTime()) / 86_400_000;
  assert.ok(Math.abs(ageDays - 45) < 0.01, `expected a 45-day cutoff, got ${ageDays}`);
});
