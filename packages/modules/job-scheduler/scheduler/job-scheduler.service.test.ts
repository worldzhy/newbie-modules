import assert from "node:assert/strict";
import test from "node:test";
import { JobHandlerRegistryService } from "./handler-registry.service";
import { JobSchedulerService } from "./job-scheduler.service";
import { JOB_RUN_FAILED_EVENT, JOB_RUN_SUCCEEDED_EVENT } from "../job-scheduler.events";

type Row = Record<string, any>;

const CONFIG: Row = {
  "modules.job-scheduler.stuckRunAfterMinutes": "30",
  "modules.job-scheduler.retentionDays": "30",
};

function newHarness(options: { runs?: Row[]; schedules?: Row[] } = {}) {
  const runs: Row[] = options.runs ?? [];
  const schedules: Row[] = options.schedules ?? [];
  const emitted: { event: string; payload: Row }[] = [];

  const prisma = {
    jobSchedule: {
      findUnique: async ({ where }: any) => schedules.find((schedule) => schedule.key === where.key) ?? null,
      findMany: async () => [...schedules],
    },
    jobRun: {
      findMany: async ({ where }: any) =>
        runs
          .filter(
            (run) =>
              run.status === where.status &&
              run.startedAt < where.startedAt.lt &&
              (where.scheduleId === undefined || run.scheduleId === where.scheduleId),
          )
          .map((run) => ({ ...run, schedule: schedules.find((schedule) => schedule.id === run.scheduleId) })),
      create: async ({ data }: any) => {
        const row: Row = { id: runs.length + 1, ...data };
        runs.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = runs.find((candidate) => candidate.id === where.id && candidate.status === where.status);
        if (!row) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) => {
        const row = runs.find((candidate) => candidate.id === where.id);
        if (!row) {
          throw new Error(`JobRun not found: ${where.id}`);
        }
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = runs.length;
        for (let index = runs.length - 1; index >= 0; index -= 1) {
          if (runs[index].startedAt < where.startedAt.lt) {
            runs.splice(index, 1);
          }
        }
        return { count: before - runs.length };
      },
    },
  };

  const registry = new JobHandlerRegistryService();
  const schedulerRegistry = {
    addCronJob: () => undefined,
    getCronJob: () => {
      throw new Error("not registered");
    },
    deleteCronJob: () => undefined,
  };
  const emitter = {
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload: payload as Row });
    },
  };
  const config = { getOrThrow: (key: string) => CONFIG[key] };

  const service = new JobSchedulerService(
    prisma as never,
    schedulerRegistry as never,
    registry,
    emitter as never,
    config as never,
  );

  return { service, runs, schedules, emitted };
}

function schedule(overrides: Row = {}): Row {
  return {
    id: 1,
    key: "demo",
    name: "Demo",
    handlerKey: "demo",
    cronExpr: "* * * * *",
    timezone: "Asia/Shanghai",
    isEnabled: true,
    payload: null,
    ...overrides,
  };
}

function runningRun(overrides: Row = {}): Row {
  return { id: 10, scheduleId: 1, trigger: "schedule", status: "running", startedAt: new Date(), ...overrides };
}

/// The sweep is private and runs from every reconcile tick, so tests drive it
/// directly instead of waiting a full interval.
function runStuckSweep(service: JobSchedulerService): Promise<void> {
  return (service as unknown as { sweepStuckRuns(): Promise<void> }).sweepStuckRuns();
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not met");
}

test("the sweep closes running rows abandoned by a previous process", async () => {
  const stale = runningRun({ startedAt: new Date(Date.now() - 31 * 60_000) });
  const { service, emitted } = newHarness({ runs: [stale], schedules: [schedule()] });

  await runStuckSweep(service);

  assert.equal(stale.status, "failed");
  assert.match(stale.error, /stuck-run threshold of 30 minutes/);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, JOB_RUN_FAILED_EVENT);
  assert.equal(emitted[0].payload.scheduleKey, "demo");
  assert.equal(emitted[0].payload.runId, 10);
});

test("the sweep leaves a run younger than the threshold untouched", async () => {
  const fresh = runningRun({ startedAt: new Date(Date.now() - 5 * 60_000) });
  const { service, emitted } = newHarness({ runs: [fresh], schedules: [schedule()] });

  await runStuckSweep(service);

  assert.equal(fresh.status, "running");
  assert.equal(emitted.length, 0);
});

test("the sweep closes an orphan once it crosses the threshold on a later tick", async () => {
  const fresh = runningRun({ startedAt: new Date(Date.now() - 5 * 60_000) });
  const { service, emitted } = newHarness({ runs: [fresh], schedules: [schedule()] });

  await runStuckSweep(service);
  assert.equal(fresh.status, "running");
  assert.equal(emitted.length, 0);

  // Time passes without a restart, so the next tick sees it past the threshold.
  fresh.startedAt = new Date(Date.now() - 45 * 60_000);
  await runStuckSweep(service);

  assert.equal(fresh.status, "failed");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, JOB_RUN_FAILED_EVENT);
  assert.equal(emitted[0].payload.runId, 10);
});

test("runs older than the retention window are pruned", async () => {
  const expired = runningRun({ id: 20, status: "success", startedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) });
  const kept = runningRun({ id: 21, status: "success", startedAt: new Date(Date.now() - 29 * 24 * 60 * 60_000) });
  const { service, runs } = newHarness({ runs: [expired, kept], schedules: [schedule()] });

  await (service as unknown as { pruneExpiredRuns(): Promise<void> }).pruneExpiredRuns();

  assert.deepEqual(
    runs.map((run) => run.id),
    [21],
  );
});

test("a run closed as stuck is rewritten to success when its handler finally returns", async () => {
  const { service, runs, emitted } = newHarness({ schedules: [schedule()] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handlers = (service as unknown as { jobHandlerRegistry: JobHandlerRegistryService }).jobHandlerRegistry;
  handlers.registerHandler("demo", async () => {
    await gate;
  });

  const pending = service.triggerSchedule("demo");
  await until(() => runs.some((run) => run.status === "running"));
  const run = runs.find((candidate) => candidate.status === "running")!;
  // Simulate the sweep closing the run while the handler is still awaited.
  Object.assign(run, { status: "failed", error: "stuck by scheduler", finishedAt: new Date() });

  release();
  await pending;

  assert.equal(run.status, "success");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, JOB_RUN_SUCCEEDED_EVENT);
  assert.equal(emitted[0].payload.runId, run.id);
});

test("the reentry guard closes a hung run and still records the trigger as skipped", async () => {
  const stale = runningRun({ startedAt: new Date(Date.now() - 45 * 60_000) });
  const { service, runs, emitted } = newHarness({ runs: [stale], schedules: [schedule()] });
  // The handler is still awaited by the first run, so the process-local guard
  // is what the next trigger sees.
  (service as unknown as { runningScheduleKeys: Set<string> }).runningScheduleKeys.add("demo");

  const skipped = await service.triggerSchedule("demo");

  assert.equal(stale.status, "failed");
  assert.equal(skipped.status, "skipped");
  assert.equal(runs.filter((run) => run.status === "skipped").length, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, JOB_RUN_FAILED_EVENT);
});
