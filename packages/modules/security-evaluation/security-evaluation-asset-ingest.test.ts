import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";

/**
 * Behavior-level test for the platform-level ingest contract (ADR-039).
 *
 * The fake below is the three tables the service writes (subject, asset,
 * provenance) plus the provenance read; it asserts what the contract promises:
 * one subject per (kind, subjectKey) regardless of how many projects submit it,
 * one provenance row per source, and idempotent re-submission.
 */

interface FakeSubjectRow {
  id: string;
  kind: string;
  scopeType: string;
  scopeId: string;
  subjectKey: string;
  displayName: string;
  metadata: Record<string, unknown> | undefined;
  credentialRef: string | null;
}

interface FakeAssetRow {
  id: string;
  subjectId: string;
  naturalKey: string;
  displayName: string;
}

interface FakeSourceRow {
  id: string;
  subjectId: string;
  sourceType: string;
  sourceId: string;
  firstSubmittedAt: Date;
  lastSubmittedAt: Date;
}

function fakePrisma() {
  const subjects: FakeSubjectRow[] = [];
  const assets: FakeAssetRow[] = [];
  const sources: FakeSourceRow[] = [];
  let nextId = 1;

  const prisma = {
    evaluationSubject: {
      upsert: async (args: {
        where: {
          kind_scopeType_scopeId_subjectKey: {
            kind: string;
            scopeType: string;
            scopeId: string;
            subjectKey: string;
          };
        };
        create: Omit<FakeSubjectRow, "id">;
        update: { displayName: string; metadata: Record<string, unknown> | undefined; credentialRef?: string | null };
      }) => {
        const key = args.where.kind_scopeType_scopeId_subjectKey;
        const existing = subjects.find(
          (row) =>
            row.kind === key.kind &&
            row.scopeType === key.scopeType &&
            row.scopeId === key.scopeId &&
            row.subjectKey === key.subjectKey,
        );
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
    securityEvaluationAsset: {
      upsert: async (args: {
        where: { subjectId: string };
        create: Omit<FakeAssetRow, "id">;
        update: { naturalKey: string; displayName: string };
      }) => {
        const existing = assets.find((row) => row.subjectId === args.where.subjectId);
        if (existing) {
          existing.naturalKey = args.update.naturalKey;
          existing.displayName = args.update.displayName;
          return existing;
        }
        const created: FakeAssetRow = { id: `asset-${nextId++}`, ...args.create };
        assets.push(created);
        return created;
      },
    },
    securityEvaluationAssetSource: {
      upsert: async (args: {
        where: { subjectId_sourceType_sourceId: { subjectId: string; sourceType: string; sourceId: string } };
        create: Omit<FakeSourceRow, "id">;
        update: { lastSubmittedAt: Date };
      }) => {
        const key = args.where.subjectId_sourceType_sourceId;
        const existing = sources.find(
          (row) =>
            row.subjectId === key.subjectId && row.sourceType === key.sourceType && row.sourceId === key.sourceId,
        );
        if (existing) {
          existing.lastSubmittedAt = args.update.lastSubmittedAt;
          return existing;
        }
        const created: FakeSourceRow = { id: `source-${nextId++}`, ...args.create };
        sources.push(created);
        return created;
      },
      findMany: async (args: { where: { sourceType?: string; sourceId?: string } }) => {
        const matched = sources.filter(
          (row) =>
            (!args.where.sourceType || row.sourceType === args.where.sourceType) &&
            (!args.where.sourceId || row.sourceId === args.where.sourceId),
        );
        return [...new Set(matched.map((row) => row.subjectId))].map((subjectId) => ({ subjectId }));
      },
    },
  };

  return { prisma: prisma as unknown as PrismaService, subjects, assets, sources };
}

/** Minimal stand-in for EvaluationSubjectService.getOrCreateSubject. */
function fakeSubjectService(prisma: PrismaService) {
  return {
    getOrCreateSubject: async (descriptor: {
      kind: string;
      scopeType: string;
      scopeId: string;
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
          kind_scopeType_scopeId_subjectKey: {
            kind: descriptor.kind,
            scopeType: descriptor.scopeType,
            scopeId: descriptor.scopeId,
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

test("ingest is idempotent per (subject, source)", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const submission = {
    kind: "repository",
    subjectKey: "repo-1",
    displayName: "owner/repo",
    sourceType: "project",
    sourceId: "project-1",
  };
  const first = await service.ingest([submission]);
  const second = await service.ingest([submission]);

  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.assets.length, 1);
  assert.equal(fake.sources.length, 1);
  assert.equal(second[0].subjectId, first[0].subjectId);
  assert.equal(second[0].assetId, first[0].assetId);
  assert.equal(fake.subjects[0].scopeType, "platform");
  assert.equal(fake.sources[0].lastSubmittedAt >= fake.sources[0].firstSubmittedAt, true);
});

test("one subject, two provenance rows when two projects submit the same asset", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "owner/repo", sourceType: "project", sourceId: "p-1" },
    { kind: "repository", subjectKey: "repo-1", displayName: "owner/repo", sourceType: "project", sourceId: "p-2" },
  ]);

  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.assets.length, 1);
  assert.equal(fake.sources.length, 2);
  assert.deepEqual(fake.sources.map((source) => source.sourceId).sort(), ["p-1", "p-2"]);
});

test("distinct subject keys stay distinct; source filter resolves them", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "one", sourceType: "project", sourceId: "p-1" },
    { kind: "repository", subjectKey: "repo-2", displayName: "two", sourceType: "project", sourceId: "p-1" },
    { kind: "aws-account", subjectKey: "123456789012", displayName: "acct", sourceType: "project", sourceId: "p-2" },
  ]);

  assert.equal(fake.subjects.length, 3);
  assert.equal(fake.assets.length, 3);
  assert.equal(fake.sources.length, 3);

  assert.equal(await service.listSubjectIdsBySource({}), null);
  assert.deepEqual(await service.listSubjectIdsBySource({ scopeType: "project", scopeId: "p-1" }), [
    fake.subjects[0].id,
    fake.subjects[1].id,
  ]);
  assert.deepEqual(await service.listSubjectIdsBySource({ scopeId: "p-2" }), [fake.subjects[2].id]);
  assert.deepEqual(await service.listSubjectIdsBySource({ scopeType: "project", scopeId: "missing" }), []);
});

test("ingest registers the credential reference; a re-registration refreshes it, an omitted one keeps it", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const submission = {
    kind: "aws-account",
    subjectKey: "123456789012",
    displayName: "acct",
    sourceType: "project",
    sourceId: "p-1",
    credentialRef: "aws-binding:binding-1",
  };
  await service.ingest([submission]);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-1");

  // The binding was recreated: the new registration overwrites the pointer.
  await service.ingest([{ ...submission, credentialRef: "aws-binding:binding-2" }]);
  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-2");

  // A submission without the field (e.g. a repository ingest) never clears it.
  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "o/r", sourceType: "project", sourceId: "p-1" },
  ]);
  assert.equal(fake.subjects[1].credentialRef, null);
  await service.ingest([
    { kind: "repository", subjectKey: "repo-1", displayName: "o/r", sourceType: "project", sourceId: "p-1" },
  ]);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-2");
});
