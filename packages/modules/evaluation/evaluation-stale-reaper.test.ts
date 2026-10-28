import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { EvaluationRun } from "@generated/prisma/client";

import { EvaluationRunnerService } from "./evaluation-runner.service";
import { EvaluationRunService, STALE_RUN_ERROR } from "./evaluation-run.service";
import { EVALUATION_RUN_FAILED_EVENT } from "./evaluation.events";
import type { EvaluationRunFinishedEvent } from "./ports/observer.port";

/**
 * Behavior-level test for the skeleton's stale-run reaper (ADR-038): a global
 * sweep fails every active row untouched past the timeout, and each reaped row
 * gets the same terminal treatment an executed run gets — the run-failed event
 * and the observer notification carrying the row's persisted error. Row-level
 * conditional writes make the sweep multi-instance safe: only the caller that
 * actually closed a row reports it.
 */

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

const SUBJECT = {
  id: SUBJECT_ID,
  kind: "repository",
  scopeType: "project",
  scopeId: "scope-1",
  subjectKey: "repo",
  displayName: "repo",
};

const VERSION = {
  id: VERSION_ID,
  kind: "repository",
  evaluationKey: "npm-osv",
  version: "1.0.0",
  publishedAt: new Date(),
};

function staleRun(id: string, updatedAt: Date): EvaluationRun {
  return {
    id,
    subjectId: SUBJECT_ID,
    criteriaVersionId: VERSION_ID,
    requestedByRef: null,
    config: null,
    status: "RUNNING",
    error: null,
    startedAt: new Date(updatedAt.getTime() - 1000),
    finishedAt: null,
    createdAt: new Date(updatedAt.getTime() - 2000),
    updatedAt,
  } as unknown as EvaluationRun;
}

/** EvaluationRunService.reapStaleRuns against a fake Prisma delegate. */
function buildRunService(rows: EvaluationRun[], updateOutcome: { count: number }) {
  const findManyArgs: Record<string, unknown>[] = [];
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const prisma = {
    evaluationRun: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        findManyArgs.push(args.where);
        return rows;
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(args);
        return updateOutcome;
      },
    },
  };
  const service = new EvaluationRunService(prisma as never, {} as never, { staleRunTimeoutMs: 30 * 60 * 1000 });
  return { service, findManyArgs, updates };
}

test("the sweep selects only stale active rows and closes them with the shared error text", async () => {
  const updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  const { service, findManyArgs, updates } = buildRunService([staleRun("run-1", updatedAt)], { count: 1 });

  const reaped = await service.reapStaleRuns();

  assert.equal(findManyArgs.length, 1);
  assert.deepEqual(findManyArgs[0].status, { in: ["QUEUED", "RUNNING"] });
  const cutoff = (findManyArgs[0].updatedAt as { lt: Date }).lt;
  assert.ok(Date.now() - cutoff.getTime() >= 30 * 60 * 1000, "cutoff must sit past the stale timeout");

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { id: "run-1", status: { in: ["QUEUED", "RUNNING"] }, updatedAt });
  assert.equal(updates[0].data.status, "FAILED");
  assert.equal(updates[0].data.error, STALE_RUN_ERROR);

  assert.equal(reaped.length, 1);
  assert.equal(reaped[0].status, "FAILED");
  assert.equal(reaped[0].error, STALE_RUN_ERROR);
});

test("a row that lost the conditional write is not reported as reaped", async () => {
  const updatedAt = new Date(Date.now() - 60 * 60 * 1000);
  const { service } = buildRunService([staleRun("run-1", updatedAt)], { count: 0 });

  const reaped = await service.reapStaleRuns();

  assert.equal(reaped.length, 0);
});

test("no stale rows means no writes", async () => {
  const { service, updates } = buildRunService([], { count: 1 });

  const reaped = await service.reapStaleRuns();

  assert.equal(reaped.length, 0);
  assert.equal(updates.length, 0);
});

/** Runner fan-out over a faked run service: events, observer, failure isolation. */
interface RunnerHarnessOptions {
  reaped?: EvaluationRun[];
  sweep?: () => Promise<EvaluationRun[]>;
}

function buildRunner(options: RunnerHarnessOptions = {}) {
  const emitted: { key: string; payload: Record<string, unknown> }[] = [];
  const observed: EvaluationRunFinishedEvent[] = [];
  let sweepCalls = 0;

  const runs = {
    reapStaleRuns: async () => {
      sweepCalls += 1;
      if (options.sweep) return options.sweep();
      return options.reaped ?? [];
    },
  };

  const subjects = { getSubject: async () => SUBJECT };
  const criteria = { getVersion: async () => VERSION };

  const events = {
    emit: (key: string, payload: Record<string, unknown>) => {
      emitted.push({ key, payload });
      return true;
    },
  };

  const providers = {
    getObserver: () => ({
      onRunFinished: async (event: EvaluationRunFinishedEvent) => {
        observed.push(event);
      },
    }),
  };

  const runner = new EvaluationRunnerService(
    providers as never,
    subjects as never,
    criteria as never,
    runs as never,
    {} as never,
    {} as never,
    events as unknown as EventEmitter2,
    { heartbeatIntervalMs: 60_000, reapIntervalMs: 60_000 },
  );

  return { runner, emitted, observed, sweepCalls: () => sweepCalls };
}

test("a reaped row publishes evaluation.run-failed with the row's persisted error and notifies the observer", async () => {
  const row = {
    ...staleRun("run-stale", new Date(Date.now() - 60 * 60 * 1000)),
    status: "FAILED",
    error: STALE_RUN_ERROR,
    finishedAt: new Date(),
  } as unknown as EvaluationRun;
  const { runner, emitted, observed } = buildRunner({ reaped: [row] });

  await runner.reapStaleRuns();

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_FAILED_EVENT);
  assert.deepEqual(emitted[0].payload, {
    runId: "run-stale",
    subjectId: SUBJECT_ID,
    subjectKind: "repository",
    criteriaVersionId: VERSION_ID,
    evaluationKey: "npm-osv",
    status: "FAILED",
    error: STALE_RUN_ERROR,
  });
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], {
    runId: "run-stale",
    subjectId: SUBJECT_ID,
    criteriaVersionId: VERSION_ID,
    status: "FAILED",
    error: STALE_RUN_ERROR,
  });
});

test("a failed sweep is logged, swallowed and retried by the next tick", async () => {
  let fail = true;
  const { runner, sweepCalls } = buildRunner({
    sweep: async () => {
      if (fail) throw new Error("database unreachable");
      return [];
    },
  });

  await runner.reapStaleRuns();
  fail = false;
  await runner.reapStaleRuns();

  assert.equal(sweepCalls(), 2);
});

test("a sweep already in flight makes the overlapping call a no-op", async () => {
  let release!: () => void;
  const gate = new Promise<EvaluationRun[]>((resolve) => {
    release = () => resolve([]);
  });
  const { runner, sweepCalls } = buildRunner({ sweep: () => gate });

  const first = runner.reapStaleRuns();
  await runner.reapStaleRuns();
  release();
  await first;

  assert.equal(sweepCalls(), 1);
});
