import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationRunService } from "./evaluation-run.service";

/**
 * Behavior-level test for the run concurrency contract (ADR-020 D1, D5.4):
 * a second run for the same subject and criteria version is rejected while the
 * first is active, and accepted again once it is terminal. The guard is the
 * database's partial unique index, so the fake below enforces exactly that
 * predicate — the service must surface it as a 409, never as a generic failure.
 */

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

interface FakeRunRow {
  id: string;
  subjectId: string;
  criteriaVersionId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  updatedAt: Date;
}

function fakePrisma() {
  const runs: FakeRunRow[] = [];
  let nextId = 1;

  const prisma = {
    evaluationSubject: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === SUBJECT_ID
          ? {
              id: SUBJECT_ID,
              kind: "repository",
              scopeType: "project",
              scopeId: "scope",
              subjectKey: "repo",
              displayName: "repo",
            }
          : null,
    },
    evaluationCriteriaVersion: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === VERSION_ID
          ? { id: VERSION_ID, kind: "repository", family: "dependency-osv", publishedAt: new Date() }
          : null,
    },
    evaluationRun: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Omit<FakeRunRow, "id" | "updatedAt"> }) => {
        // The partial unique index: one active run per (subjectId, version).
        const active = runs.some(
          (run) =>
            run.subjectId === data.subjectId &&
            run.criteriaVersionId === data.criteriaVersionId &&
            (run.status === "QUEUED" || run.status === "RUNNING"),
        );
        if (active) {
          const error = new Error("Unique constraint failed: EvaluationRun_one_active_per_subject_version") as Error & {
            code: string;
          };
          error.code = "P2002";
          throw error;
        }
        const row: FakeRunRow = { ...data, id: `run-${nextId++}`, updatedAt: new Date() };
        runs.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => runs.find((run) => run.id === where.id) ?? null,
    },
  };

  return { prisma: prisma as unknown as PrismaService, runs };
}

function serviceFor(prisma: PrismaService) {
  return new EvaluationRunService(prisma, {} as never);
}

test("a second run for the same subject and version is rejected while the first is active", async () => {
  const { prisma, runs } = fakePrisma();
  const service = serviceFor(prisma);

  const first = await service.startRun({ subjectId: SUBJECT_ID, criteriaVersionId: VERSION_ID });
  assert.equal(runs.length, 1);

  await assert.rejects(
    () => service.startRun({ subjectId: SUBJECT_ID, criteriaVersionId: VERSION_ID }),
    /already running for subject/,
  );
  assert.equal(runs.length, 1, "the rejected request must not leave a second run row behind");

  runs[0].status = "RUNNING";
  await assert.rejects(
    () => service.startRun({ subjectId: SUBJECT_ID, criteriaVersionId: VERSION_ID }),
    /already running for subject/,
  );

  // Once the active run is terminal the same subject and version run again.
  runs[0].status = "SUCCEEDED";
  await service.startRun({ subjectId: SUBJECT_ID, criteriaVersionId: VERSION_ID });
  assert.equal(runs.length, 2);
  assert.equal(first.subjectId, SUBJECT_ID);
});
