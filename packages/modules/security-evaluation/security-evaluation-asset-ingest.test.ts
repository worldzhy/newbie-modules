import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";

/**
 * Behavior-level test for the platform-level ingest contract (ADR-039, ADR-068
 * D8).
 *
 * The fake below is the one table the service writes (subject); it asserts what
 * the contract promises: one subject per (kind, subjectKey) regardless of how
 * many projects submit it, and idempotent re-submission. Provenance no longer
 * exists — ownership is enumerated by the host.
 */

interface FakeSubjectRow {
  id: string;
  kind: string;
  subjectKey: string;
  displayName: string;
  metadata: Record<string, unknown> | undefined;
  credentialRef: string | null;
}

function fakePrisma() {
  const subjects: FakeSubjectRow[] = [];
  let nextId = 1;

  const prisma = {
    evaluationSubject: {
      upsert: async (args: {
        where: {
          kind_subjectKey: {
            kind: string;
            subjectKey: string;
          };
        };
        create: Omit<FakeSubjectRow, "id">;
        update: { displayName: string; metadata: Record<string, unknown> | undefined; credentialRef?: string | null };
      }) => {
        const key = args.where.kind_subjectKey;
        const existing = subjects.find((row) => row.kind === key.kind && row.subjectKey === key.subjectKey);
        if (existing) {
          existing.displayName = args.update.displayName;
          existing.metadata = args.update.metadata;
          // Mirrors EvaluationSubjectService: an omitted ref never clears the
          // stored one; an explicit value (including null) overwrites.
          if (args.update.credentialRef !== undefined) {
            existing.credentialRef = args.update.credentialRef;
          }
          return existing;
        }
        const created: FakeSubjectRow = { id: `subject-${nextId++}`, ...args.create };
        subjects.push(created);
        return created;
      },
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        subjects.filter((row) => args.where.id.in.includes(row.id)),
    },
  };

  return { prisma: prisma as unknown as PrismaService, subjects };
}

/** Minimal stand-in for EvaluationSubjectService.getOrCreateSubject. */
function fakeSubjectService(prisma: PrismaService) {
  return {
    getOrCreateSubject: async (descriptor: {
      kind: string;
      subjectKey: string;
      displayName: string;
      metadata?: Record<string, unknown>;
      credentialRef?: string | null;
    }) => {
      const { evaluationSubject } = prisma as unknown as {
        evaluationSubject: { upsert: (args: unknown) => Promise<FakeSubjectRow> };
      };
      return evaluationSubject.upsert({
        where: {
          kind_subjectKey: {
            kind: descriptor.kind,
            subjectKey: descriptor.subjectKey,
          },
        },
        create: { ...descriptor, credentialRef: descriptor.credentialRef ?? null },
        update: {
          displayName: descriptor.displayName,
          metadata: descriptor.metadata,
          ...(descriptor.credentialRef !== undefined ? { credentialRef: descriptor.credentialRef } : {}),
        },
      });
    },
  };
}

function serviceWith(fake: ReturnType<typeof fakePrisma>) {
  return new SecurityEvaluationAssetService(fake.prisma, fakeSubjectService(fake.prisma) as never);
}

test("ingest is idempotent per (kind, subjectKey)", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const submission = {
    kind: "repository",
    subjectKey: "repo-1",
    displayName: "owner/repo",
  };
  const first = await service.ingest([submission]);
  const second = await service.ingest([submission]);

  assert.equal(fake.subjects.length, 1);
  assert.equal(second[0].subjectId, first[0].subjectId);
  assert.equal(fake.subjects[0].subjectKey, "repo-1");
});

test("two projects submitting the same repository share one subject", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "owner/repo" },
    { kind: "repository", subjectKey: "repo-1", displayName: "owner/repo" },
  ]);

  assert.equal(fake.subjects.length, 1);
});

test("distinct subject keys stay distinct", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "one" },
    { kind: "repository", subjectKey: "repo-2", displayName: "two" },
    { kind: "aws-account", subjectKey: "123456789012", displayName: "acct" },
  ]);

  assert.equal(fake.subjects.length, 3);
});

test("ingest registers the credential reference; a re-registration refreshes it, an omitted one keeps it", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const submission = {
    kind: "aws-account",
    subjectKey: "123456789012",
    displayName: "acct",
    credentialRef: "aws-binding:binding-1",
  };
  await service.ingest([submission]);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-1");

  // The binding was recreated: the new registration overwrites the pointer.
  await service.ingest([{ ...submission, credentialRef: "aws-binding:binding-2" }]);
  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-2");

  // A submission without the field (e.g. a repository ingest) never clears it.
  await service.ingest([{ kind: "repository", subjectKey: "repo-1", displayName: "o/r" }]);
  assert.equal(fake.subjects[1].credentialRef, null);
  await service.ingest([{ kind: "repository", subjectKey: "repo-1", displayName: "o/r" }]);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-2");
});
