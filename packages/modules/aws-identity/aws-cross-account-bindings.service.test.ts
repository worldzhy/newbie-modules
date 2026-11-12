import assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";
import { AwsCrossAccountBindingsService } from "./aws-cross-account-bindings.service";

/**
 * Contract tests for ADR-056: the cross-account binding is account-scoped and
 * consumers reference it through AwsCrossAccountBindingUsage.
 *
 * These run against an in-memory fake of the two Prisma delegates the service
 * uses, so no database or AWS credentials are needed.
 */

const ACCOUNT_ID = "111122223333";
const ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/NightwatchCrossAccountRole`;
const CONSUMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONSUMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface BindingRow {
  id: string;
  accountId: string;
  roleArn: string | null;
  externalId: string;
  pendingExternalId: string | null;
  roleName: string | null;
  rotationLambdaArn: string | null;
  defaultRegion: string | null;
  regions: string[];
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UsageRow {
  id: string;
  consumerId: string;
  bindingId: string;
  createdAt: Date;
  updatedAt: Date;
}

let sequence = 0;

function seedBinding(overrides: Partial<BindingRow> = {}): BindingRow {
  sequence += 1;
  const now = new Date();
  return {
    id: `binding-${sequence}`,
    accountId: ACCOUNT_ID,
    roleArn: ROLE_ARN,
    externalId: "external-id",
    pendingExternalId: null,
    roleName: "NightwatchCrossAccountRole",
    rotationLambdaArn: null,
    defaultRegion: "us-east-1",
    regions: ["us-east-1"],
    lastVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Minimal in-memory stand-in for the Prisma delegates the service touches.
 * It mimics only the query shapes the service actually issues.
 */
function createFakePrisma(bindings: BindingRow[] = [], usages: UsageRow[] = []) {
  sequence += 1;
  return {
    state: { bindings, usages },
    awsCrossAccountBinding: {
      async findMany() {
        // The service asks for the usages alongside each binding (include),
        // so the fake decorates every row with its consumer IDs.
        return bindings.map((binding) => ({
          ...binding,
          usages: usages.filter((row) => row.bindingId === binding.id).map((row) => ({ consumerId: row.consumerId })),
        }));
      },
      async findUnique({ where }: { where: { id?: string; accountId?: string } }) {
        return (
          bindings.find((row) => (where.id !== undefined ? row.id === where.id : row.accountId === where.accountId)) ??
          null
        );
      },
      async findFirst({ where }: { where: { roleArn?: string; accountId?: { not?: string } } }) {
        return bindings.find((row) => row.roleArn === where.roleArn && row.accountId !== where.accountId?.not) ?? null;
      },
      async create({ data }: { data: Partial<BindingRow> }) {
        const now = new Date();
        const row: BindingRow = {
          id: `binding-${(sequence += 1)}`,
          accountId: data.accountId!,
          roleArn: data.roleArn ?? null,
          externalId: data.externalId!,
          pendingExternalId: data.pendingExternalId ?? null,
          roleName: data.roleName ?? null,
          rotationLambdaArn: data.rotationLambdaArn ?? null,
          defaultRegion: data.defaultRegion ?? null,
          regions: data.regions ?? [],
          lastVerifiedAt: data.lastVerifiedAt ?? null,
          createdAt: now,
          updatedAt: now,
        };
        bindings.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<BindingRow> }) {
        const row = bindings.find((candidate) => candidate.id === where.id);
        if (!row) {
          throw new Error(`Binding not found: ${where.id}`);
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      async delete({ where }: { where: { id: string } }) {
        const index = bindings.findIndex((candidate) => candidate.id === where.id);
        if (index < 0) {
          throw new Error(`Binding not found: ${where.id}`);
        }
        return bindings.splice(index, 1)[0];
      },
    },
    awsCrossAccountBindingUsage: {
      async findUnique({ where }: { where: { consumerId: string } }) {
        const usage = usages.find((row) => row.consumerId === where.consumerId);
        if (!usage) {
          return null;
        }
        return { ...usage, binding: bindings.find((row) => row.id === usage.bindingId) ?? null };
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { consumerId: string };
        create: { consumerId: string; bindingId: string };
        update: { bindingId: string };
      }) {
        const existing = usages.find((row) => row.consumerId === where.consumerId);
        if (existing) {
          existing.bindingId = update.bindingId;
          existing.updatedAt = new Date();
          return existing;
        }
        const now = new Date();
        const row: UsageRow = {
          id: `usage-${(sequence += 1)}`,
          consumerId: create.consumerId,
          bindingId: create.bindingId,
          createdAt: now,
          updatedAt: now,
        };
        usages.push(row);
        return row;
      },
      async deleteMany({ where }: { where: { consumerId: string } }) {
        const before = usages.length;
        for (let index = usages.length - 1; index >= 0; index -= 1) {
          if (usages[index].consumerId === where.consumerId) {
            usages.splice(index, 1);
          }
        }
        return { count: before - usages.length };
      },
      async count({ where }: { where: { bindingId: string } }) {
        return usages.filter((row) => row.bindingId === where.bindingId).length;
      },
    },
  };
}

function createService(prisma: ReturnType<typeof createFakePrisma>): AwsCrossAccountBindingsService {
  const configService = {
    get: () => ({ platformAccountId: "999988887777" }),
  };
  // The fake prisma implements the delegates the service uses; the service
  // only needs those, so the cast keeps the fake readable.
  return new AwsCrossAccountBindingsService(
    prisma as unknown as ConstructorParameters<typeof AwsCrossAccountBindingsService>[0],
    configService as unknown as ConstructorParameters<typeof AwsCrossAccountBindingsService>[1],
  );
}

test("two consumers attached to the same account share one binding", async () => {
  const binding = seedBinding();
  const prisma = createFakePrisma([binding]);
  const service = createService(prisma);

  const attachedA = await service.attachConsumerCredential(CONSUMER_A, ACCOUNT_ID);
  const attachedB = await service.attachConsumerCredential(CONSUMER_B, ACCOUNT_ID);

  assert.equal(prisma.state.usages.length, 2, "one usage row per consumer");
  assert.deepEqual(
    new Set(prisma.state.usages.map((row) => row.bindingId)),
    new Set([binding.id]),
    "both usages point at the same binding",
  );
  assert.equal(attachedA.accountId, ACCOUNT_ID);
  assert.equal(attachedB.accountId, ACCOUNT_ID);

  const credentialA = await service.resolveProjectCredential(CONSUMER_A);
  const credentialB = await service.resolveProjectCredential(CONSUMER_B);
  assert.equal(credentialA.bindingId, binding.id);
  assert.equal(credentialB.bindingId, binding.id, "both consumers resolve the account's single binding");
  assert.equal(credentialA.accountId, ACCOUNT_ID);
});

test("deleting an account that a consumer still references is rejected", async () => {
  const binding = seedBinding();
  const prisma = createFakePrisma([binding]);
  const service = createService(prisma);
  await service.attachConsumerCredential(CONSUMER_A, ACCOUNT_ID);

  await assert.rejects(() => service.deleteAccountCredential(ACCOUNT_ID), ConflictException);
  assert.equal(prisma.state.bindings.length, 1, "the binding is preserved while it is in use");
});

test("the account list reports which consumers reference each account", async () => {
  const binding = seedBinding();
  const prisma = createFakePrisma([binding]);
  const service = createService(prisma);

  await service.attachConsumerCredential(CONSUMER_A, ACCOUNT_ID);
  await service.attachConsumerCredential(CONSUMER_B, ACCOUNT_ID);

  const listed = await service.listAccountCredentials();
  assert.deepEqual(listed.accounts[0].consumerIds, [CONSUMER_A, CONSUMER_B]);
  assert.equal(listed.accounts[0].accountId, ACCOUNT_ID);
});
