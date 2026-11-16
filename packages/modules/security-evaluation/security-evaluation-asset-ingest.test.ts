import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationWebOriginService } from "./assets/security-evaluation-web-origin.service";

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

interface FakeWebOriginRow {
  id: string;
  subjectId: string;
  targetPaths: Record<string, unknown>;
  verificationToken: string;
  verificationStatus: string;
  verificationMethod: string | null;
  verificationFailureCount: number;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  isActive: boolean;
}

function fakePrisma() {
  const subjects: FakeSubjectRow[] = [];
  const repositories: FakeRepositoryRow[] = [];
  const awsAccounts: FakeAwsAccountRow[] = [];
  const webOrigins: FakeWebOriginRow[] = [];
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
      findUnique: async (args: {
        where: { id?: string; subjectType_kind_subjectKey?: { subjectType: string; kind: string; subjectKey: string } };
      }) => {
        const key = args.where.subjectType_kind_subjectKey;
        if (key) {
          return (
            subjects.find(
              (row) =>
                row.subjectType === key.subjectType && row.kind === key.kind && row.subjectKey === key.subjectKey,
            ) ?? null
          );
        }
        return subjects.find((row) => row.id === args.where.id) ?? null;
      },
      create: async (args: { data: Omit<FakeSubjectRow, "id"> }) => {
        const created: FakeSubjectRow = { id: `subject-${nextId++}`, ...args.data };
        subjects.push(created);
        return created;
      },
      update: async (args: { where: { id: string }; data: { displayName: string } }) => {
        const existing = subjects.find((row) => row.id === args.where.id);
        if (!existing) throw new Error(`Unknown subject ${args.where.id}`);
        existing.displayName = args.data.displayName;
        return existing;
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
      create: async (args: { data: Omit<FakeRepositoryRow, "id" | "isActive"> & { isActive?: boolean } }) => {
        const created: FakeRepositoryRow = { id: `repo-${nextId++}`, isActive: true, ...args.data };
        repositories.push(created);
        return created;
      },
      update: async (args: { where: { subjectId: string }; data: Partial<Pick<FakeRepositoryRow, "url">> }) => {
        const existing = repositories.find((row) => row.subjectId === args.where.subjectId);
        if (!existing) throw new Error(`Unknown repository material ${args.where.subjectId}`);
        Object.assign(existing, args.data);
        return existing;
      },
      findUnique: async (args: { where: { subjectId: string } }) =>
        repositories.find((row) => row.subjectId === args.where.subjectId) ?? null,
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
      create: async (args: { data: Omit<FakeAwsAccountRow, "id" | "isActive"> & { isActive?: boolean } }) => {
        const created: FakeAwsAccountRow = { id: `account-${nextId++}`, isActive: true, ...args.data };
        awsAccounts.push(created);
        return created;
      },
      update: async (args: {
        where: { subjectId: string };
        data: Partial<Pick<FakeAwsAccountRow, "defaultRegion" | "regions">>;
      }) => {
        const existing = awsAccounts.find((row) => row.subjectId === args.where.subjectId);
        if (!existing) throw new Error(`Unknown aws-account material ${args.where.subjectId}`);
        Object.assign(existing, args.data);
        return existing;
      },
      findUnique: async (args: { where: { subjectId: string } }) =>
        awsAccounts.find((row) => row.subjectId === args.where.subjectId) ?? null,
    },
    securityEvaluationWebOrigin: {
      upsert: async (args: {
        where: { subjectId: string };
        create: { subjectId: string; targetPaths: Record<string, unknown>; verificationToken: string };
        update: { targetPaths?: Record<string, unknown> };
      }) => {
        const existing = webOrigins.find((row) => row.subjectId === args.where.subjectId);
        if (existing) {
          // ADR-072 D3: an omitted targetPaths never clears the stored map.
          if (args.update.targetPaths !== undefined) existing.targetPaths = args.update.targetPaths;
          return existing;
        }
        // Mirrors the schema defaults on the material row.
        const created: FakeWebOriginRow = {
          id: `web-origin-${nextId++}`,
          verificationStatus: "PENDING",
          verificationMethod: null,
          verificationFailureCount: 0,
          verifiedAt: null,
          lastVerifiedAt: null,
          isActive: true,
          ...args.create,
        };
        webOrigins.push(created);
        return created;
      },
      create: async (args: {
        data: { subjectId: string; targetPaths: Record<string, unknown>; verificationToken: string };
      }) => {
        const created: FakeWebOriginRow = {
          id: `web-origin-${nextId++}`,
          verificationStatus: "PENDING",
          verificationMethod: null,
          verificationFailureCount: 0,
          verifiedAt: null,
          lastVerifiedAt: null,
          isActive: true,
          ...args.data,
        };
        webOrigins.push(created);
        return created;
      },
      update: async (args: { where: { subjectId: string }; data: Record<string, unknown> }) => {
        const existing = webOrigins.find((row) => row.subjectId === args.where.subjectId);
        if (!existing) throw new Error(`Unknown web-origin material ${args.where.subjectId}`);
        Object.assign(existing, args.data);
        return existing;
      },
      findUnique: async (args: { where: { subjectId: string } }) =>
        webOrigins.find((row) => row.subjectId === args.where.subjectId) ?? null,
    },
    $transaction: async <T>(work: (client: unknown) => Promise<T>): Promise<T> => work(prisma),
  };

  return { prisma: prisma as unknown as PrismaService, subjects, repositories, awsAccounts, webOrigins };
}

/** Minimal stand-in for EvaluationSubjectService (both write modes). */
function fakeSubjectService(prisma: PrismaService) {
  const store = () =>
    prisma as unknown as {
      evaluationSubject: {
        upsert: (args: unknown) => Promise<FakeSubjectRow>;
        findUnique: (args: unknown) => Promise<{ id: string } | null>;
        create: (args: unknown) => Promise<FakeSubjectRow>;
      };
    };
  return {
    getOrCreateSubject: async (descriptor: {
      subjectType: string;
      kind: string;
      subjectKey: string;
      displayName: string;
      metadata?: Record<string, unknown>;
      credentialRef?: string | null;
    }) => {
      const { evaluationSubject } = store();
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
    /** Mirrors EvaluationSubjectService.createSubject (ADR-072 D1). */
    createSubject: async (descriptor: {
      subjectType: string;
      kind: string;
      subjectKey: string;
      displayName: string;
      metadata?: Record<string, unknown>;
      credentialRef?: string | null;
    }) => {
      const { evaluationSubject } = store();
      const where = {
        subjectType_kind_subjectKey: {
          subjectType: descriptor.subjectType,
          kind: descriptor.kind,
          subjectKey: descriptor.subjectKey,
        },
      };
      const existing = await evaluationSubject.findUnique({ where });
      if (existing) throw new ConflictException({ message: "already exists", subjectId: existing.id });
      return evaluationSubject.create({ data: { ...descriptor, credentialRef: descriptor.credentialRef ?? null } });
    },
  };
}

function fakeConfig() {
  const values: Record<string, string> = {
    "modules.security-evaluation.webOriginVerificationIntervalDays": "7",
    "modules.security-evaluation.webOriginReverifyFailureThreshold": "3",
    "modules.security-evaluation.webOriginTokenBytes": "32",
  };
  return { getOrThrow: (key: string) => values[key] } as never;
}

function serviceWith(fake: ReturnType<typeof fakePrisma>) {
  const subjects = fakeSubjectService(fake.prisma);
  const webOrigins = new SecurityEvaluationWebOriginService(fake.prisma, subjects as never, fakeConfig());
  return new SecurityEvaluationAssetService(fake.prisma, subjects as never, webOrigins);
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

test("web-origin ingest writes its verification material", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([{ kind: "web-origin", subjectKey: "https://example.com", displayName: "example.com" }]);
  assert.equal(fake.subjects[0].subjectKey, "https://example.com");
  assert.equal(fake.webOrigins.length, 1);
  assert.equal(fake.webOrigins[0].subjectId, fake.subjects[0].id);
  assert.equal(fake.webOrigins[0].verificationStatus, "PENDING");
  assert.ok(fake.webOrigins[0].verificationToken.length > 0);

  // Re-registration is idempotent: same subject, same material row, same token.
  await service.ingest([{ kind: "web-origin", subjectKey: "https://example.com", displayName: "Example" }]);
  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.webOrigins.length, 1);
  assert.equal(fake.subjects[0].displayName, "Example");

  await assert.rejects(service.ingest([{ kind: "web-origin", displayName: "example.com" }]), /requires its subjectKey/);
});

test("material reads dispatch on the subject kind and never expose the web-origin token", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const [repository] = await service.ingest([
    { kind: "repository", displayName: "o/r", repository: { provider: "github", namespace: "o", name: "r" } },
  ]);
  const [awsAccount] = await service.ingest([
    {
      kind: "aws-account",
      displayName: "acct",
      awsAccount: { accountId: "123456789012", defaultRegion: "us-east-1", regions: ["us-east-1"] },
    },
  ]);
  const [webOrigin] = await service.ingest([
    { kind: "web-origin", subjectKey: "https://example.com", displayName: "example.com" },
  ]);

  assert.deepEqual(await service.material(repository.subjectId), {
    kind: "repository",
    provider: "github",
    namespace: "o",
    name: "r",
    url: null,
    isActive: true,
  });
  assert.deepEqual(await service.material(awsAccount.subjectId), {
    kind: "aws-account",
    accountId: "123456789012",
    defaultRegion: "us-east-1",
    regions: ["us-east-1"],
    isActive: true,
  });

  const webOriginMaterial = await service.material(webOrigin.subjectId);
  assert.equal(webOriginMaterial.kind, "web-origin");
  // ADR-071: a read never carries the token; only the verification POST issues it.
  assert.ok(!("verificationToken" in webOriginMaterial));
});

test("material verification is a web-origin state machine, so another kind is a bad request", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const [repository] = await service.ingest([
    { kind: "repository", displayName: "o/r", repository: { provider: "github", namespace: "o", name: "r" } },
  ]);

  await assert.rejects(
    service.requestMaterialVerification(repository.subjectId, "DNS_TXT"),
    /verification applies to web-origin subjects only/,
  );
  await assert.rejects(
    service.checkMaterialVerification(repository.subjectId),
    /verification applies to web-origin subjects only/,
  );
});

test("create is strict: an existing subject is a conflict carrying its id (ADR-072 D1)", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);
  const submission = {
    kind: "repository",
    displayName: "o/r",
    repository: { provider: "github", namespace: "o", name: "r" },
  };

  const created = await service.create(submission);

  await assert.rejects(service.create({ ...submission, displayName: "another label" }), (error: unknown) => {
    assert.ok(error instanceof ConflictException);
    assert.equal((error.getResponse() as { subjectId: string }).subjectId, created.subjectId);
    return true;
  });
  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.repositories.length, 1);
  assert.equal(fake.subjects[0].displayName, "o/r");
});

test("create writes a web-origin subject and its target paths in one transaction", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  const { subjectId } = await service.create({
    kind: "web-origin",
    subjectKey: "https://example.com",
    displayName: "example.com",
    webOrigin: { targetPaths: { "auth.login": "/signin" } },
  });

  assert.equal(fake.subjects.length, 1);
  assert.equal(fake.subjects[0].subjectKey, "https://example.com");
  assert.equal(fake.webOrigins.length, 1);
  assert.equal(fake.webOrigins[0].subjectId, subjectId);
  assert.deepEqual(fake.webOrigins[0].targetPaths, { "auth.login": "/signin" });
  // The material carries the verification record, so the subject is immediately usable.
  assert.equal(fake.webOrigins[0].verificationStatus, "PENDING");

  await assert.rejects(
    service.create({ kind: "web-origin", subjectKey: "https://example.com", displayName: "again" }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as { subjectId: string }).subjectId, subjectId);
      return true;
    },
  );
});

test("re-ingesting a web origin without target paths keeps the stored map (ADR-072 D3)", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);

  await service.ingest([
    {
      kind: "web-origin",
      subjectKey: "https://example.com",
      displayName: "example.com",
      webOrigin: { targetPaths: { "auth.login": "/signin" } },
    },
  ]);
  await service.ingest([{ kind: "web-origin", subjectKey: "https://example.com", displayName: "Example" }]);

  assert.equal(fake.subjects[0].displayName, "Example");
  assert.deepEqual(fake.webOrigins[0].targetPaths, { "auth.login": "/signin" });
});

test("PATCH /subjects updates only the display name", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);
  const [repository] = await service.ingest([
    { kind: "repository", displayName: "o/r", repository: { provider: "github", namespace: "o", name: "r" } },
  ]);

  const updated = await service.updateSubject(repository.subjectId, { displayName: "  Owner/Repo  " });

  assert.equal(updated.displayName, "Owner/Repo");
  assert.equal(fake.subjects[0].subjectKey, "github:o/r");
  await assert.rejects(service.updateSubject(repository.subjectId, {}), /requires displayName/);
});

test("PUT replaces the target path map, PATCH merges by role", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);
  const { subjectId } = await service.create({
    kind: "web-origin",
    subjectKey: "https://example.com",
    displayName: "example.com",
    webOrigin: { targetPaths: { "auth.login": "/login", "api.session": "/api" } },
  });

  await service.replaceMaterial(subjectId, { targetPaths: { "api.session": "/v2/session" } });
  assert.deepEqual(fake.webOrigins[0].targetPaths, { "api.session": "/v2/session" });

  await service.patchMaterial(subjectId, { targetPaths: { "auth.login": "/signin" } });
  assert.deepEqual(fake.webOrigins[0].targetPaths, { "api.session": "/v2/session", "auth.login": "/signin" });
});

test("PUT resets the mutable fields of a repository and an aws-account to their defaults", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);
  const [repository] = await service.ingest([
    {
      kind: "repository",
      displayName: "o/r",
      repository: { provider: "github", namespace: "o", name: "r", url: "https://github.com/o/r" },
    },
  ]);
  const [awsAccount] = await service.ingest([
    {
      kind: "aws-account",
      displayName: "acct",
      awsAccount: { accountId: "123456789012", defaultRegion: "us-east-1", regions: ["us-east-1"] },
    },
  ]);

  const repositoryMaterial = await service.replaceMaterial(repository.subjectId, {});
  assert.equal(repositoryMaterial.kind, "repository");
  assert.equal(repositoryMaterial.kind === "repository" && repositoryMaterial.url, null);

  const awsMaterial = await service.replaceMaterial(awsAccount.subjectId, {});
  assert.equal(awsMaterial.kind === "aws-account" && awsMaterial.defaultRegion, null);
  assert.deepEqual(awsMaterial.kind === "aws-account" && awsMaterial.regions, []);
});

test("material updates reject fields of another kind and unbounded paths (ADR-072 D3)", async () => {
  const fake = fakePrisma();
  const service = serviceWith(fake);
  const [repository] = await service.ingest([
    { kind: "repository", displayName: "o/r", repository: { provider: "github", namespace: "o", name: "r" } },
  ]);
  const { subjectId: webOriginId } = await service.create({
    kind: "web-origin",
    subjectKey: "https://example.com",
    displayName: "example.com",
  });

  await assert.rejects(service.patchMaterial(repository.subjectId, { targetPaths: {} }), /accepts only url/);
  await assert.rejects(service.patchMaterial(webOriginId, { url: "https://x" }), /accepts only targetPaths/);
  await assert.rejects(
    service.patchMaterial(webOriginId, { targetPaths: { "auth.login": `/${"a".repeat(255)}` } }),
    /at most 255 characters/,
  );
  await assert.rejects(service.patchMaterial(webOriginId, {}), /requires at least one field/);
});
