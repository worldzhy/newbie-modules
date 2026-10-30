import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { EvaluationRun } from "@generated/prisma/client";

import { EvaluationRunnerService } from "./evaluation-runner.service";
import { formatRunError } from "./evaluation-run.service";
import { EVALUATION_RUN_FAILED_EVENT, EVALUATION_RUN_SUCCEEDED_EVENT } from "./evaluation.events";
import type { EvaluationRunFinishedEvent } from "./ports/observer.port";

/**
 * Behavior-level test for the skeleton's run lifecycle events (ADR-032): the
 * runner publishes exactly one terminal event per run, after the terminal row
 * is written, carrying identity and terminal state only. The failure text is
 * the same one the run row persists, and a broken event channel never changes
 * what the run concluded.
 */

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const EVIDENCE_ID = "pkg:npm:lodash@4.17.20";

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

interface EvidenceCollectionStub {
  items: { id: string; layer: string; source: string; summary: string; observedAt: Date }[];
  declaredUnlinked: { total: number };
  skipped: { total: number };
}

interface TerminalRow {
  status: "SUCCEEDED" | "FAILED";
  error?: string;
}

interface BuildOptions {
  collect?: () => Promise<EvidenceCollectionStub>;
  subjectLookupFails?: boolean;
  emit?: () => void;
  /** When set, markFailed conflicts as if the reaper already failed the row. */
  reapedError?: string;
  /** When set, the run row cannot be read back after the markFailed conflict. */
  rowLookupFails?: boolean;
  /** When set, assertActive throws — the runner must stop writing on a dead run. */
  assertActiveFailure?: { kind: "stale" | "restarted" };
}

function buildRunner(options: BuildOptions = {}) {
  const terminal: TerminalRow[] = [];
  const emitted: { key: string; payload: Record<string, unknown> }[] = [];
  const observed: EvaluationRunFinishedEvent[] = [];

  const running = {
    id: "run-1",
    subjectId: SUBJECT_ID,
    ruleSetVersionId: VERSION_ID,
    config: null,
    startedAt: new Date(),
    status: "RUNNING",
  } as unknown as EvaluationRun;

  const providers = {
    getEvidenceProvider: () => ({
      collect:
        options.collect ??
        (async () => ({
          items: [
            { id: EVIDENCE_ID, layer: "fact", source: "lockfile", summary: "lodash 4.17.20", observedAt: new Date() },
          ],
          declaredUnlinked: { total: 0 },
          skipped: { total: 0 },
        })),
    }),
    getJudgmentPort: () => ({
      judge: async () => ({ verdicts: [], findings: [], evaluatedRefs: [EVIDENCE_ID] }),
    }),
    getObserver: () => ({
      onRunFinished: async (event: EvaluationRunFinishedEvent) => {
        observed.push(event);
      },
    }),
  };

  const subjects = {
    getSubject: async () => {
      if (options.subjectLookupFails) throw new Error("Evaluation subject vanished");
      return SUBJECT;
    },
  };

  const criteria = {
    getVersion: async () => VERSION,
    listCriteria: async () => [],
  };

  const runs = {
    touch: async () => undefined,
    assertActive: async () => {
      if (options.assertActiveFailure?.kind === "stale") {
        throw new Error("Evaluation run run-1 is no longer active (status FAILED) — superseded or reaped as stale");
      }
      if (options.assertActiveFailure?.kind === "restarted") {
        throw new Error("Evaluation run run-1 was restarted while this execution was in flight");
      }
    },
    markSucceeded: async () => {
      terminal.push({ status: "SUCCEEDED" });
    },
    markFailed: async (_id: string, error: unknown) => {
      if (options.reapedError !== undefined) {
        throw new Error("Evaluation run run-1 cannot be marked failed: it is already FAILED (reaped as stale)");
      }
      terminal.push({ status: "FAILED", error: formatRunError(error) });
    },
    findById: async () => {
      if (options.rowLookupFails) throw new Error("Evaluation run run-1 not found");
      return { ...running, status: "FAILED", error: options.reapedError ?? null };
    },
  };

  const results = {
    createResult: async () => ({ id: "result-1" }),
  };

  const findings = {
    recordFindings: async () => [],
    resolveAbsentFindings: async () => 0,
  };

  const events = {
    emit: (key: string, payload: Record<string, unknown>) => {
      emitted.push({ key, payload });
      options.emit?.();
      return true;
    },
  };

  const runner = new EvaluationRunnerService(
    providers as never,
    subjects as never,
    criteria as never,
    runs as never,
    results as never,
    findings as never,
    events as unknown as EventEmitter2,
    { heartbeatIntervalMs: 60_000 },
  );

  return { runner, running, terminal, emitted, observed };
}

const EXPECTED_IDENTITY = {
  runId: "run-1",
  subjectId: SUBJECT_ID,
  subjectKind: "repository",
  ruleSetVersionId: VERSION_ID,
  evaluationKey: "npm-osv",
};

test("a successful run publishes evaluation.run-succeeded once with its identity", async () => {
  const { runner, running, terminal, emitted } = buildRunner();

  const outcome = await runner.execute(running);

  assert.equal(outcome.runId, "run-1");
  assert.deepEqual(terminal, [{ status: "SUCCEEDED" }]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_SUCCEEDED_EVENT);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "SUCCEEDED" });
});

test("a failed run publishes evaluation.run-failed once with the run row's error", async () => {
  const failure = new Error("OSV API request timed out after 30000ms");
  const { runner, running, terminal, emitted } = buildRunner({
    collect: async () => {
      throw failure;
    },
  });

  await assert.rejects(() => runner.execute(running), /OSV API request timed out/);

  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "FAILED");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_FAILED_EVENT);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "FAILED", error: terminal[0].error });
});

test("the failed event carries the same truncated error the run row stores", async () => {
  const failure = new Error("x".repeat(1500));
  const { runner, running, terminal, emitted } = buildRunner({
    collect: async () => {
      throw failure;
    },
  });

  await assert.rejects(() => runner.execute(running));

  assert.equal(terminal[0].error?.length, 1000);
  assert.equal(emitted[0].payload.error, terminal[0].error);
});

test("a publish failure does not change the terminal outcome", async () => {
  const { runner, running, terminal } = buildRunner({
    emit: () => {
      throw new Error("event channel down");
    },
  });

  const outcome = await runner.execute(running);

  assert.equal(outcome.runId, "run-1");
  assert.deepEqual(terminal, [{ status: "SUCCEEDED" }]);
});

test("a publish failure does not mask the run's original error", async () => {
  const failure = new Error("collector exploded");
  const { runner, running, terminal } = buildRunner({
    collect: async () => {
      throw failure;
    },
    emit: () => {
      throw new Error("event channel down");
    },
  });

  await assert.rejects(() => runner.execute(running), /collector exploded/);
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "FAILED");
});

test("a run that fails before its identity is resolved is still failed, with no event emitted", async () => {
  const { runner, running, terminal, emitted } = buildRunner({ subjectLookupFails: true });

  await assert.rejects(() => runner.execute(running), /Evaluation subject vanished/);

  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "FAILED");
  assert.equal(emitted.length, 0);
});

test("an invariant problem list reaches the row, the event and the observer verbatim", async () => {
  const problems = [
    "coverageStats.skipped requires a note explaining the cut-off",
    "verdict quality references unknown evidence pkg:npm:ghost@0.0.0",
  ];
  const { runner, running, terminal, emitted, observed } = buildRunner({
    collect: async () => {
      throw new BadRequestException(problems);
    },
  });

  await assert.rejects(() => runner.execute(running));

  const persisted = terminal[0].error ?? "";
  for (const problem of problems) {
    assert.ok(persisted.includes(problem), `run row error must carry "${problem}"`);
  }
  assert.equal(emitted[0].payload.error, persisted);
  assert.equal(observed[0].error, persisted);
});

test("when the row was failed underneath, the event and the observer carry the row's error", async () => {
  const reapedError = "Run expired as stale after 1800000ms without a heartbeat";
  const { runner, running, terminal, emitted, observed } = buildRunner({
    collect: async () => {
      throw new Error("collector exploded");
    },
    reapedError,
  });

  await assert.rejects(() => runner.execute(running), /collector exploded/);

  assert.equal(terminal.length, 0);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_FAILED_EVENT);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "FAILED", error: reapedError });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].error, reapedError);
});

test("when the row cannot be read back, the event falls back to the execution's own error", async () => {
  const failure = new Error("collector exploded");
  const { runner, running, terminal, emitted } = buildRunner({
    collect: async () => {
      throw failure;
    },
    reapedError: "stale",
    rowLookupFails: true,
  });

  await assert.rejects(() => runner.execute(running), /collector exploded/);

  assert.equal(terminal.length, 0);
  assert.equal(emitted.length, 1);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "FAILED", error: formatRunError(failure) });
});

// --- assertActive fencing (ADR-032) ---------------------------------------

test("assertActive stops a run that was reaped mid-execution; the reap's error is what every channel carries", async () => {
  const reapError = "Run abandoned: no progress within the timeout window (process restart?)";
  const { runner, running, terminal, emitted, observed } = buildRunner({
    assertActiveFailure: { kind: "stale" },
    reapedError: reapError,
  });

  await assert.rejects(() => runner.execute(running), /is no longer active|stale/);

  assert.equal(terminal.length, 0, "the reap already closed the row; markFailed must not double-write");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_FAILED_EVENT);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "FAILED", error: reapError });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].error, reapError);
});

test("assertActive stops a run that was restarted mid-flight; the restart's fencing error becomes the failure", async () => {
  const { runner, running, terminal, emitted, observed } = buildRunner({
    assertActiveFailure: { kind: "restarted" },
  });

  await assert.rejects(() => runner.execute(running), /restarted while this execution was in flight/);

  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, "FAILED");
  assert.match(terminal[0].error ?? "", /restarted while this execution was in flight/);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].key, EVALUATION_RUN_FAILED_EVENT);
  assert.deepEqual(emitted[0].payload, { ...EXPECTED_IDENTITY, status: "FAILED", error: terminal[0].error });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].error, terminal[0].error);
});
