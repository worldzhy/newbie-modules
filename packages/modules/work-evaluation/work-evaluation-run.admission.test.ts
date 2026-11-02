import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException, NotFoundException } from "@nestjs/common";

import { WorkEvaluationRunService } from "./work-evaluation-run.service";

/**
 * Admission contract of the run trigger (ADR-029): period eligibility and the
 * evaluatee's existence are validated on the request path, skeleton admission
 * (`runner.open`) surfaces its conflicts synchronously, and only the judgment
 * execution is detached.
 */
function buildService(overrides?: {
  period?: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  openError?: Error;
}) {
  const period = overrides?.period ?? { id: "period-1", type: "COLLECTION", status: "ACTIVE" };
  const user = overrides?.user === undefined ? { id: "user-1", name: "Ada", email: "ada@dev.test" } : overrides?.user;
  const calls: { open: unknown[]; execute: unknown[] } = { open: [], execute: [] };
  const runner = {
    open: async (input: unknown) => {
      calls.open.push(input);
      if (overrides?.openError) throw overrides.openError;
      return { id: "run-1" };
    },
    execute: async (run: unknown) => {
      calls.execute.push(run);
      return { run };
    },
  };
  const service = new WorkEvaluationRunService(
    runner as never,
    {} as never,
    {} as never,
    {
      getOrCreateSubject: async () => ({ id: "subject-1" }),
    } as never,
    { getPeriodById: async () => period } as never,
    { user: { findUnique: async () => user } } as never,
  );
  return { service, calls };
}

const input = {
  evaluateeUserId: "user-1",
  periodId: "period-1",
  config: { modelScope: "kimi-k3" },
};

describe("WorkEvaluationRunService.startRun admission", () => {
  it("opens the run on the request path and detaches only the execution", async () => {
    const { service, calls } = buildService();
    await service.startRun(input);
    assert.equal(calls.open.length, 1);
    const opened = calls.open[0] as { subjectId: string; config: Record<string, unknown> };
    assert.equal(opened.subjectId, "subject-1");
    assert.equal(opened.config.periodId, "period-1");
    assert.equal(opened.config.modelScope, "kimi-k3");
    assert.deepEqual(calls.execute, [{ id: "run-1" }]);
  });

  it("surfaces skeleton admission conflicts synchronously instead of answering 202", async () => {
    const { service } = buildService({ openError: new ConflictException("already has an active run") });
    await assert.rejects(service.startRun(input), ConflictException);
  });

  it("rejects a missing evaluatee before opening anything", async () => {
    const { service, calls } = buildService({ user: null });
    await assert.rejects(service.startRun(input), NotFoundException);
    assert.deepEqual(calls.open, []);
  });
});
