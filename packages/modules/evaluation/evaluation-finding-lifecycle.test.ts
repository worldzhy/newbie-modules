import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationRun } from "@generated/prisma/client";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationFindingService } from "./evaluation-finding.service";

/**
 * Behavior-level test for the assertion lifecycle (ADR-020 D2): a finding
 * outlives the run that produced it, keeps its first-seen timestamp, resolves
 * when a later run of the same evaluationKey no longer observes it, reopens when it
 * reappears, and never lets a re-run overwrite a human suppression.
 *
 * The fake below is the finding table plus the two criteria lookups the service
 * reads; everything else the service asserts is its own contract.
 */

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const CRITERION_KEY = "dependency-vulnerability";
const FINGERPRINT = "npm:lodash:GHSA-aaaa-bbbb-cccc";
const EVIDENCE_ID = "pkg:npm:lodash@4.17.20";

interface FakeFindingRow {
  id: string;
  subjectId: string;
  evaluationKey: string;
  fingerprint: string;
  criterionKey: string;
  severity: string;
  status: "OPEN" | "RESOLVED" | "SUPPRESSED";
  title: string;
  detail: string | undefined;
  metadata: Record<string, unknown> | undefined;
  firstSeenRunId: string;
  lastSeenRunId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  suppressionNote: string | null;
  suppressedByRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function fakePrisma() {
  const rows: FakeFindingRow[] = [];
  let nextId = 1;

  const prisma = {
    evaluationFinding: {
      findUnique: async (args: {
        where: {
          id?: string;
          subjectId_evaluationKey_fingerprint?: { subjectId: string; evaluationKey: string; fingerprint: string };
        };
      }) => {
        const unique = args.where.subjectId_evaluationKey_fingerprint;
        if (unique) {
          return (
            rows.find(
              (row) =>
                row.subjectId === unique.subjectId &&
                row.evaluationKey === unique.evaluationKey &&
                row.fingerprint === unique.fingerprint,
            ) ?? null
          );
        }
        return rows.find((row) => row.id === args.where.id) ?? null;
      },
      create: async ({ data }: { data: Omit<FakeFindingRow, "id" | "createdAt" | "updatedAt"> }) => {
        const duplicate = rows.some(
          (row) =>
            row.subjectId === data.subjectId &&
            row.evaluationKey === data.evaluationKey &&
            row.fingerprint === data.fingerprint,
        );
        if (duplicate) {
          const error = new Error(
            "Unique constraint failed: EvaluationFinding_subjectId_evaluationKey_fingerprint_key",
          ) as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        const row: FakeFindingRow = {
          ...data,
          id: `finding-${nextId++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.push(row);
        return { ...row };
      },
      updateMany: async (args: {
        where: {
          id: string;
          status?: string;
          lastSeenAt?: { lt: Date };
          NOT?: { lastSeenRunId?: string };
        };
        data: Partial<FakeFindingRow>;
      }) => {
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row) return { count: 0 };
        if (args.where.status && row.status !== args.where.status) return { count: 0 };
        Object.assign(row, args.data, { updatedAt: new Date() });
        return { count: 1 };
      },
      findMany: async (args: {
        where: {
          subjectId: string;
          evaluationKey: string;
          status?: string;
          lastSeenAt?: { lt: Date };
          NOT?: { lastSeenRunId?: string };
        };
        select?: unknown;
      }) => {
        const { where } = args;
        return rows
          .filter(
            (row) =>
              row.subjectId === where.subjectId &&
              row.evaluationKey === where.evaluationKey &&
              (!where.status || row.status === where.status) &&
              (!where.lastSeenAt || row.lastSeenAt < where.lastSeenAt.lt) &&
              (!where.NOT?.lastSeenRunId || row.lastSeenRunId !== where.NOT.lastSeenRunId),
          )
          .map((row) => ({ ...row }));
      },
    },
  };

  return { prisma: prisma as unknown as PrismaService, rows };
}

function serviceFor(prisma: PrismaService) {
  const criteria = {
    listCriteria: async () => [{ criterionKey: CRITERION_KEY, kind: "ASSERTION", name: "Known vulnerability" }],
    getVersion: async () => ({ id: VERSION_ID, kind: "repository", evaluationKey: "npm-osv", version: "1" }),
  };
  const providers = { getObserver: () => undefined };
  return new EvaluationFindingService(prisma, criteria as never, providers as never);
}

function runRow(id: string, startedAt: Date): EvaluationRun {
  return {
    id,
    subjectId: SUBJECT_ID,
    criteriaVersionId: VERSION_ID,
    status: "RUNNING",
    requestedByRef: null,
    config: null,
    error: null,
    startedAt,
    finishedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  } as EvaluationRun;
}

const candidate = {
  criterionKey: CRITERION_KEY,
  fingerprint: FINGERPRINT,
  severity: "HIGH" as const,
  title: "lodash: prototype pollution",
  evidenceRefs: [EVIDENCE_ID],
  metadata: { packageName: "lodash" },
};

test("a finding is created once, kept open across runs, resolved when absent and reopened on reappearance", async () => {
  const { prisma, rows } = fakePrisma();
  const service = serviceFor(prisma);

  const firstRun = runRow("run-1", new Date("2026-01-01T00:00:00.000Z"));
  const [created] = await service.recordFindings(firstRun, [candidate], [EVIDENCE_ID]);
  assert.equal(rows.length, 1);
  assert.equal(created.status, "OPEN");
  assert.equal(created.firstSeenRunId, "run-1");
  assert.deepEqual(created.firstSeenAt, firstRun.startedAt);

  // A second run that still observes the problem keeps the same row and its
  // first-seen timestamp; only the last-seen fields move.
  const secondRun = runRow("run-2", new Date("2026-01-02T00:00:00.000Z"));
  const [reobserved] = await service.recordFindings(secondRun, [candidate], [EVIDENCE_ID]);
  assert.equal(rows.length, 1);
  assert.equal(reobserved.id, created.id);
  assert.equal(reobserved.status, "OPEN");
  assert.deepEqual(reobserved.firstSeenAt, firstRun.startedAt);
  assert.equal(reobserved.lastSeenRunId, "run-2");

  // A later run of the same evaluationKey that does not observe it resolves it.
  const thirdRun = runRow("run-3", new Date("2026-01-03T00:00:00.000Z"));
  assert.equal(await service.resolveAbsentFindings(thirdRun), 1);
  assert.equal(rows[0].status, "RESOLVED");
  assert.ok(rows[0].resolvedAt instanceof Date);

  // Reappearance reopens it with the original first-seen timestamp.
  const fourthRun = runRow("run-4", new Date("2026-01-04T00:00:00.000Z"));
  const [reopened] = await service.recordFindings(fourthRun, [candidate], [EVIDENCE_ID]);
  assert.equal(reopened.id, created.id);
  assert.equal(reopened.status, "OPEN");
  assert.equal(reopened.resolvedAt, null);
  assert.deepEqual(reopened.firstSeenAt, firstRun.startedAt);
});

test("a suppressed finding stays suppressed when a later run observes it again", async () => {
  const { prisma, rows } = fakePrisma();
  const service = serviceFor(prisma);

  const firstRun = runRow("run-1", new Date("2026-01-01T00:00:00.000Z"));
  await service.recordFindings(firstRun, [candidate], [EVIDENCE_ID]);
  rows[0].status = "SUPPRESSED";
  rows[0].suppressionNote = "Accepted risk for the build toolchain";
  rows[0].suppressedByRef = "user-1";

  const secondRun = runRow("run-2", new Date("2026-01-02T00:00:00.000Z"));
  await service.recordFindings(secondRun, [candidate], [EVIDENCE_ID]);

  assert.equal(rows[0].status, "SUPPRESSED");
  assert.equal(rows[0].suppressionNote, "Accepted risk for the build toolchain");
  assert.equal(rows[0].lastSeenRunId, "run-2");

  // A suppression also survives a resolve pass in the same evaluationKey.
  const thirdRun = runRow("run-3", new Date("2026-01-03T00:00:00.000Z"));
  assert.equal(await service.resolveAbsentFindings(thirdRun), 0);
  assert.equal(rows[0].status, "SUPPRESSED");
});
