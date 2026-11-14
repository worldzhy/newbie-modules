import assert from "node:assert/strict";
import test from "node:test";
import { JobHandlerRegistryService } from "./handler-registry.service";
import { JobSchedulerService } from "./job-scheduler.service";
import { JOB_RUN_FAILED_EVENT } from "../job-scheduler.events";

type Row = Record<string, any>;

const CONFIG: Row = {
  "modules.job-scheduler.stuckRunTimeoutMinutes": "30",
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

test("boot closes running rows abandoned by a previous process", async () => {
  const stale = runningRun({ startedAt: new Date(Date.now() - 31 * 60_000) });
  const { service, emitted } = newHarness({ runs: [stale], schedules: [schedule()] });

  await service.onApplicationBootstrap();

  assert.equal(stale.status, "failed");
  assert.match(stale.error, /stuck-run threshold of 30 minutes/);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, JOB_RUN_FAILED_EVENT);
  assert.equal(emitted[0].payload.scheduleKey, "demo");
  assert.equal(emitted[0].payload.runId, 10);
});

test("boot leaves a run younger than the threshold untouched", async () => {
  const fresh = runningRun({ startedAt: new Date(Date.now() - 5 * 60_000) });
  const { service, emitted } = newHarness({ runs: [fresh], schedules: [schedule()] });

  await service.onApplicationBootstrap();

  assert.equal(fresh.status, "running");
  assert.equal(emitted.length, 0);
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
