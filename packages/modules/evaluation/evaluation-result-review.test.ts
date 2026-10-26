import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationResultReviewStatus } from "@generated/prisma/client";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationResultService } from "./evaluation-result.service";

/**
 * Behavior-level test for the supervisor review (ADR-031): the review is the
 * one lifecycle write over an otherwise immutable result. It records who
 * decided, a re-review replaces the whole review state, and an omitted note
 * clears the previous one — the row always reflects exactly the latest say.
 *
 * The fake below is the result table; everything else the service asserts is
 * its own contract.
 */

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RESULT_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

interface FakeResultRow {
  id: string;
  runId: string;
  subjectId: string;
  criteriaVersionId: string;
  contentHash: string;
  coverageStats: object;
  verdicts: object;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  reviewStatus: "APPROVED" | "REJECTED" | null;
  reviewedByRef: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}

function fakePrisma() {
  const row: FakeResultRow = {
    id: RESULT_ID,
    runId: "run-1",
    subjectId: SUBJECT_ID,
    criteriaVersionId: VERSION_ID,
    contentHash: "hash-1",
    coverageStats: {},
    verdicts: {},
    summary: null,
    metadata: null,
    reviewStatus: null,
    reviewedByRef: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: CREATED_AT,
  };
  let exists = true;
  let lastWriteData: Record<string, unknown> | undefined;

  const prisma = {
    evaluationResult: {
      findUnique: async (args: { where: { id: string } }) => {
        return exists && args.where.id === row.id ? { ...row } : null;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        if (!exists || args.where.id !== row.id) {
          throw new Error("Record to update not found");
        }
        lastWriteData = args.data;
        Object.assign(row, args.data);
        return { ...row };
      },
    },
  };

  return {
    prisma: prisma as unknown as PrismaService,
    row,
    setExists: (value: boolean) => (exists = value),
    lastWrite: () => lastWriteData,
  };
}

function serviceFor(prisma: PrismaService) {
  return new EvaluationResultService(prisma, {} as never);
}

test("a review records the supervisor verdict, reviewer and note; the snapshot stays untouched", async () => {
  const { prisma, row, lastWrite } = fakePrisma();
  const service = serviceFor(prisma);

  const reviewed = await service.reviewResult({
    id: RESULT_ID,
    reviewStatus: EvaluationResultReviewStatus.APPROVED,
    reviewedByRef: "user-1",
    note: "Conclusion matches the transcripts I checked",
  });

  assert.equal(reviewed.reviewStatus, "APPROVED");
  assert.equal(reviewed.reviewedByRef, "user-1");
  assert.ok(reviewed.reviewedAt instanceof Date);
  assert.equal(reviewed.reviewNote, "Conclusion matches the transcripts I checked");

  // The review write touches only the review columns — the archived snapshot
  // fields are not part of it.
  assert.deepEqual(
    Object.keys(lastWrite() ?? {}).sort(),
    ["reviewNote", "reviewStatus", "reviewedByRef", "reviewedAt"].sort(),
  );
  assert.equal(row.contentHash, "hash-1");
  assert.equal(row.createdAt.getTime(), CREATED_AT.getTime());
});

test("a re-review overwrites the whole review state; an omitted note clears the previous one", async () => {
  const { prisma, row } = fakePrisma();
  const service = serviceFor(prisma);

  await service.reviewResult({
    id: RESULT_ID,
    reviewStatus: EvaluationResultReviewStatus.APPROVED,
    reviewedByRef: "user-1",
    note: "Endorsed after spot check",
  });
  const rejected = await service.reviewResult({
    id: RESULT_ID,
    reviewStatus: EvaluationResultReviewStatus.REJECTED,
    reviewedByRef: "user-2",
  });

  assert.equal(rejected.reviewStatus, "REJECTED");
  assert.equal(rejected.reviewedByRef, "user-2");
  assert.ok(rejected.reviewedAt instanceof Date);
  assert.equal(rejected.reviewNote, null);
  assert.equal(row.reviewStatus, "REJECTED");
  assert.equal(row.reviewNote, null);
});

test("reviewing an unknown result is a NotFound, not a write", async () => {
  const { prisma, lastWrite } = fakePrisma();
  const service = serviceFor(prisma);

  await assert.rejects(
    service.reviewResult({
      id: "99999999-9999-4999-8999-999999999999",
      reviewStatus: EvaluationResultReviewStatus.REJECTED,
      reviewedByRef: "user-1",
    }),
    (error: unknown) => error instanceof Error && error.message.includes("not found"),
  );
  assert.equal(lastWrite(), undefined);
});
