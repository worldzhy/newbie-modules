import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";

/**
 * Behavior-level test for the platform-level ingest contract (ADR-039, ADR-068
 * D8, ADR-070).
 *
 * The fake below is what the service writes — the subject plus the material row
 * of the kind. It asserts what the contract promises: identity is the natural
 * coordinate (never a host id), the coordinate is normalized so casing cannot
 * fork a subject, and re-submission is idempotent per
 * `(subjectType, kind, subjectKey)`.
 */

interface FakeSubjectRow {
  id: string;
  subjectType: string;
  kind: string;
  subjectKey: string;
  displayName: string;
  metadata: Record<string, unknown> | undefined;
  credentialRef: string | null;
}

interface FakeRepositoryRow {
  id: string;
  subjectId: string;
  provider: string;
  namespace: string;
  name: string;
  url: string | null;
  isActive: boolean;
}

interface FakeAwsAccountRow {
  id: string;
  subjectId: string;
  accountId: string;
  defaultRegion: string | null | undefined;
  regions: string[];
  isActive: boolean;
}

function fakePrisma() {
  const subjects: FakeSubjectRow[] = [];
  const repositories: FakeRepositoryRow[] = [];
  const awsAccounts: FakeAwsAccountRow[] = [];
  let nextId = 1;

  const prisma = {
    evaluationSubject: {
      upsert: async (args: {
        where: {
          subjectType_kind_subjectKey: {
            subjectType: string;
            kind: string;
            subjectKey: string;
          };
        };
        create: Omit<FakeSubjectRow, "id">;
        update: { displayName: string; metadata: Record<string, unknown> | undefined; credentialRef?: string | null };
      }) => {
        const key = args.where.subjectType_kind_subjectKey;
        const existing = subjects.find(
          (row) => row.subjectType === key.subjectType && row.kind === key.kind && row.subjectKey === key.subjectKey,
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
    },
    securityEvaluationRepository: {
      upsert: async (args: {
        where: { provider_namespace_name: { provider: string; namespace: string; name: string } };
        create: Omit<FakeRepositoryRow, "id" | "isActive"> & { isActive?: boolean };
        update: Partial<Omit<FakeRepositoryRow, "id" | "subjectId">>;
      }) => {
        const key = args.where.provider_namespace_name;
        const existing = repositories.find(
          (row) => row.provider === key.provider && row.namespace === key.namespace && row.name === key.name,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        // Mirrors the schema default on the material row.
        const created: FakeRepositoryRow = { id: `repo-${nextId++}`, isActive: true, ...args.create };
        repositories.push(created);
        return created;
      },
    },
    securityEvaluationAwsAccount: {
      upsert: async (args: {
        where: { accountId: string };
        create: Omit<FakeAwsAccountRow, "id" | "isActive"> & { isActive?: boolean };
        update: Partial<Omit<FakeAwsAccountRow, "id" | "subjectId" | "accountId">>;
      }) => {
        const existing = awsAccounts.find((row) => row.accountId === args.where.accountId);
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const created: FakeAwsAccountRow = { id: `account-${nextId++}`, isActive: true, ...args.create };
        awsAccounts.push(created);
        return created;
      },
    },
    $transaction: async <T>(work: (client: unknown) => Promise<T>): Promise<T> => work(prisma),
  };

  return { prisma: prisma as unknown as PrismaService, subjects, repositories, awsAccounts };
}

/** Minimal stand-in for EvaluationSubjectService.getOrCreateSubject. */
function fakeSubjectService(prisma: PrismaService) {
  return {
    getOrCreateSubject: async (descriptor: {
      subjectType: string;
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
          subjectType_kind_subjectKey: {
            subjectType: descriptor.subjectType,
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

test("repository ingest derives the natural key and its material row", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const [result] = await service.ingest([
    {
      kind: "repository",
      displayName: "WorldZhy/Devbie",
      repository: {
        provider: "GitHub",
        namespace: "WorldZhy",
        name: "Devbie",
        url: "https://github.com/worldzhy/devbie",
      },
    },
  ]);

  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.subjects[0].subjectKey, "github:worldzhy/devbie");
  // The display name keeps the original casing; identity does not.
  assert.equal(fake.subjects[0].displayName, "WorldZhy/Devbie");
  assert.equal(fake.repositories.length, 1);
  assert.equal(fake.repositories[0].subjectId, result.subjectId);
  assert.deepEqual(
    { ...fake.repositories[0], id: undefined, subjectId: undefined },
    {
      id: undefined,
      subjectId: undefined,
      provider: "github",
      namespace: "worldzhy",
      name: "devbie",
      url: "https://github.com/worldzhy/devbie",
      isActive: true,
    },
  );
});

test("ingest is idempotent per natural coordinate, including casing variants", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const [first] = await service.ingest([
    {
      kind: "repository",
      displayName: "worldzhy/devbie",
      repository: { provider: "github", namespace: "worldzhy", name: "devbie" },
    },
  ]);
  // Two projects declaring the same repository with different casing.
  const [second] = await service.ingest([
    {
      kind: "repository",
      displayName: "WorldZhy/Devbie",
      repository: { provider: "GitHub", namespace: "WorldZhy", name: "Devbie" },
    },
  ]);

  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.repositories.length, 1);
  assert.equal(second.subjectId, first.subjectId);
});

test("re-ingest refreshes the material row instead of duplicating it", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", displayName: "o/r", repository: { provider: "github", namespace: "o", name: "r" } },
  ]);
  await service.ingest([
    {
      kind: "repository",
      displayName: "o/r",
      repository: { provider: "github", namespace: "o", name: "r", url: "https://github.com/o/r" },
    },
  ]);

  assert.equal(fake.repositories.length, 1);
  assert.equal(fake.repositories[0].url, "https://github.com/o/r");
});

test("distinct repositories and aws accounts stay distinct", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    { kind: "repository", displayName: "one", repository: { provider: "github", namespace: "o", name: "one" } },
    { kind: "repository", displayName: "two", repository: { provider: "github", namespace: "o", name: "two" } },
    { kind: "aws-account", displayName: "acct", awsAccount: { accountId: "123456789012" } },
  ]);

  assert.equal(fake.subjects.length, 3);
  assert.equal(fake.repositories.length, 2);
  assert.equal(fake.awsAccounts.length, 1);
});

test("aws-account ingest normalizes regions and the account id", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    {
      kind: "aws-account",
      displayName: "acct",
      awsAccount: {
        accountId: " 123456789012 ",
        defaultRegion: " us-east-1 ",
        regions: ["us-east-1", " us-east-1 ", "", "eu-west-1"],
      },
    },
  ]);

  assert.equal(fake.subjects[0].subjectKey, "123456789012");
  assert.equal(fake.awsAccounts.length, 1);
  assert.equal(fake.awsAccounts[0].defaultRegion, "us-east-1");
  assert.deepEqual(fake.awsAccounts[0].regions, ["us-east-1", "eu-west-1"]);
});

test("ingest registers the credential reference; a re-registration refreshes it, an omitted one keeps it", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const submission = {
    kind: "aws-account",
    displayName: "acct",
    awsAccount: { accountId: "123456789012" },
    credentialRef: "aws-binding:binding-1",
  };
  await service.ingest([submission]);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-1");

  // The binding was recreated: the new registration overwrites the pointer.
  await service.ingest([{ ...submission, credentialRef: "aws-binding:binding-2" }]);
  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.subjects[0].credentialRef, "aws-binding:binding-2");
});

test("a submitted key may echo the derived key but never override it", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const base = {
    kind: "repository",
    displayName: "o/r",
    repository: { provider: "github", namespace: "o", name: "r" },
  };
  await service.ingest([{ ...base, subjectKey: "github:o/r" }]);
  assert.equal(fake.subjects.length, 1);

  await assert.rejects(service.ingest([{ ...base, subjectKey: "repo-1" }]), /does not match the natural key/);
});

test("material kinds reject submissions without their material", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await assert.rejects(
    service.ingest([{ kind: "repository", displayName: "o/r" }]),
    /requires its repository coordinate/,
  );
  await assert.rejects(service.ingest([{ kind: "aws-account", displayName: "acct" }]), /requires its accountId/);
});

test("other kinds still carry their own subject key", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([{ kind: "web-origin", subjectKey: "https://example.com", displayName: "example.com" }]);
  assert.equal(fake.subjects[0].subjectKey, "https://example.com");

  await assert.rejects(service.ingest([{ kind: "web-origin", displayName: "example.com" }]), /requires its subjectKey/);
});
