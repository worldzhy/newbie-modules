import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";

import {
  PenetrationTestingTargetService,
  type CreatePenetrationTestingTargetInput,
} from "./penetration-testing-target.service";

interface TargetRow {
  id: string;
  subjectId: string;
  environment: string;
  declaredPorts: number[];
  targetPaths: Record<string, string>;
  verificationStatus: string;
  verificationToken: string;
  verificationMethod: string | null;
  verifiedAt: Date | null;
  lastVerifiedAt: Date | null;
  verificationFailureCount: number;
  isActive: boolean;
}

function createHarness(initial: TargetRow | null) {
  let row: TargetRow | null = initial ? { ...initial } : null;
  const updates: Record<string, unknown>[] = [];
  const target = {
    findUnique: async ({ where }: { where: { subjectId: string } }) =>
      row && row.subjectId === where.subjectId ? { ...row } : null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      row = {
        id: "target-1",
        subjectId: data.subjectId as string,
        environment: data.environment as string,
        declaredPorts: (data.declaredPorts as number[]) ?? [],
        targetPaths: (data.targetPaths as Record<string, string>) ?? {},
        verificationStatus: "PENDING",
        verificationToken: data.verificationToken as string,
        verificationMethod: null,
        verifiedAt: null,
        lastVerifiedAt: null,
        verificationFailureCount: 0,
        isActive: true,
      };
      return { ...row };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data);
      row = { ...row!, ...(data as Partial<TargetRow>) };
      return { ...row };
    },
  };
  const prisma = {
    $transaction: async (run: (tx: unknown) => unknown) => run({ penetrationTestingTarget: target }),
  } as unknown as PrismaService;
  const subjects = {
    getOrCreateSubject: async () => ({ id: "subject-1" }),
  } as unknown as EvaluationSubjectService;
  const service = new PenetrationTestingTargetService(prisma, subjects);
  return { service, updates, current: () => row };
}

function verifiedRow(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    id: "target-1",
    subjectId: "subject-1",
    environment: "NON_PRODUCTION",
    declaredPorts: [80, 443],
    targetPaths: { entry: "/", "api.session": "/api/session" },
    verificationStatus: "VERIFIED",
    verificationToken: "token-a",
    verificationMethod: "DNS_TXT",
    verifiedAt: new Date("2026-11-01T00:00:00.000Z"),
    lastVerifiedAt: new Date("2026-11-20T00:00:00.000Z"),
    verificationFailureCount: 2,
    isActive: true,
    ...overrides,
  };
}

function registration(
  overrides: Partial<CreatePenetrationTestingTargetInput> = {},
): CreatePenetrationTestingTargetInput {
  return {
    origin: "https://example.com",
    environment: "NON_PRODUCTION",
    declaredPorts: [80, 443],
    targetPaths: { entry: "/", "api.session": "/api/session" },
    ...overrides,
  };
}

describe("penetration-testing target registration", () => {
  it("keeps verification state for an identical re-registration", async () => {
    const harness = createHarness(verifiedRow());
    const result = await harness.service.create(registration());

    assert.equal(result.verificationStatus, "VERIFIED");
    assert.equal(result.verificationToken, "token-a");
    assert.equal(harness.current()!.verificationStatus, "VERIFIED");
    assert.equal(harness.current()!.verificationToken, "token-a");
    assert.equal("verificationStatus" in harness.updates[0], false);
    assert.equal("verificationToken" in harness.updates[0], false);
  });

  it("treats declared ports and path maps as unordered material", async () => {
    const harness = createHarness(verifiedRow());
    const result = await harness.service.create(
      registration({
        declaredPorts: [443, 80],
        targetPaths: { "api.session": "/api/session", entry: "/" },
      }),
    );

    assert.equal(result.verificationStatus, "VERIFIED");
    assert.equal(result.verificationToken, "token-a");
  });

  it("rotates the token and clears verification when material changes", async () => {
    const harness = createHarness(verifiedRow());
    const result = await harness.service.create(registration({ declaredPorts: [80, 443, 8443] }));

    assert.equal(result.verificationStatus, "PENDING");
    assert.notEqual(result.verificationToken, "token-a");
    const row = harness.current()!;
    assert.equal(row.verificationMethod, null);
    assert.equal(row.verifiedAt, null);
    assert.equal(row.lastVerifiedAt, null);
    assert.equal(row.verificationFailureCount, 0);
  });

  it("rotates the token when only the environment changes", async () => {
    const harness = createHarness(verifiedRow({ environment: "PRODUCTION" }));
    const result = await harness.service.create(registration({ environment: "NON_PRODUCTION" }));

    assert.equal(result.verificationStatus, "PENDING");
    assert.notEqual(result.verificationToken, "token-a");
  });

  it("refuses to resurrect a revoked target", async () => {
    const harness = createHarness(verifiedRow({ verificationStatus: "REVOKED" }));

    await assert.rejects(harness.service.create(registration()), /revoked and cannot be re-registered/);
    assert.equal(harness.current()!.verificationStatus, "REVOKED");
    assert.equal(harness.current()!.verificationToken, "token-a");
  });
});
