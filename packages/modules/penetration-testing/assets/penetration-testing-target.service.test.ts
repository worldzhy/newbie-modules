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

function createHarness(initial: TargetRow | null, extraRows: TargetRow[] = []) {
  const rows: TargetRow[] = [...(initial ? [{ ...initial }] : []), ...extraRows.map((row) => ({ ...row }))];
  const updates: Record<string, unknown>[] = [];
  const findRow = (subjectId: string) => rows.find((row) => row.subjectId === subjectId) ?? null;
  const target = {
    findUnique: async ({ where }: { where: { subjectId: string } }) => {
      const row = findRow(where.subjectId);
      return row ? { ...row } : null;
    },
    findMany: async ({
      where,
    }: {
      where?: { environment?: string; verificationStatus?: string; isActive?: boolean };
    } = {}) =>
      rows
        .filter(
          (row) =>
            (!where?.environment || row.environment === where.environment) &&
            (!where?.verificationStatus || row.verificationStatus === where.verificationStatus) &&
            (where?.isActive === undefined || row.isActive === where.isActive),
        )
        .map((row) => ({ ...row })),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const created: TargetRow = {
        id: `target-${rows.length + 1}`,
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
      rows.push(created);
      return { ...created };
    },
    update: async ({ where, data }: { where: { subjectId: string }; data: Record<string, unknown> }) => {
      updates.push(data);
      const row = findRow(where.subjectId)!;
      Object.assign(row, data);
      return { ...row };
    },
  };
  const subjectKeys = new Map<string, { subjectKey: string; displayName: string }>([
    ["subject-1", { subjectKey: "https://example.com", displayName: "Example" }],
  ]);
  extraRows.forEach((row) => {
    subjectKeys.set(row.subjectId, { subjectKey: `https://${row.subjectId}.example.com`, displayName: row.subjectId });
  });
  const prisma = {
    $transaction: async (run: (tx: unknown) => unknown) => run({ penetrationTestingTarget: target }),
    penetrationTestingTarget: target,
    evaluationSubject: {
      findUnique: async ({ where }: { where: { id: string } }) => subjectKeys.get(where.id) ?? null,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => {
          const subject = subjectKeys.get(id);
          return subject ? [{ id, ...subject }] : [];
        }),
    },
  } as unknown as PrismaService;
  const subjects = {
    getOrCreateSubject: async () => ({ id: "subject-1" }),
  } as unknown as EvaluationSubjectService;
  const service = new PenetrationTestingTargetService(prisma, subjects);
  return { service, updates, current: () => findRow("subject-1"), rows: () => rows };
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

describe("penetration-testing target reads and patches", () => {
  it("lists every target without exposing the ownership token", async () => {
    const harness = createHarness(verifiedRow(), [verifiedRow({ subjectId: "subject-2" })]);

    const materials = await harness.service.list();

    assert.equal(materials.length, 2);
    assert.deepEqual(
      materials.map((material) => material.subjectId),
      ["subject-1", "subject-2"],
    );
    for (const material of materials) {
      assert.equal("verificationToken" in material, false);
      assert.equal(material.verificationStatus, "VERIFIED");
    }
  });

  it("filters the list by environment and verification status", async () => {
    const harness = createHarness(verifiedRow(), [
      verifiedRow({ subjectId: "subject-2", environment: "PRODUCTION", verificationStatus: "PENDING" }),
    ]);

    assert.deepEqual(
      (await harness.service.list({ environment: "PRODUCTION" })).map((material) => material.subjectId),
      ["subject-2"],
    );
    assert.deepEqual(
      (await harness.service.list({ verificationStatus: "VERIFIED" })).map((material) => material.subjectId),
      ["subject-1"],
    );
  });

  it("keeps verification when a patch changes only the label", async () => {
    const harness = createHarness(verifiedRow());

    const material = await harness.service.update("subject-1", { label: "Renamed" });

    assert.equal(material.verificationStatus, "VERIFIED");
    assert.equal(harness.current()!.verificationToken, "token-a");
  });

  it("resets verification when a patch changes declared material", async () => {
    const harness = createHarness(verifiedRow());

    const material = await harness.service.update("subject-1", { declaredPorts: [80, 443, 8443] });

    assert.equal(material.verificationStatus, "PENDING");
    assert.notEqual(harness.current()!.verificationToken, "token-a");
  });

  it("returns both publish placements for the ownership token", async () => {
    const harness = createHarness(verifiedRow());

    const challenge = await harness.service.verificationChallenge("subject-1");

    assert.equal(challenge.verificationToken, "token-a");
    assert.equal(challenge.dnsTxt.name, "_nightwatch-verify.example.com");
    assert.equal(challenge.dnsTxt.value, "nightwatch-verify=token-a");
    assert.equal(challenge.wellKnown.url, "https://example.com/.well-known/nightwatch-verification.txt");
    assert.equal(challenge.wellKnown.body, "token-a");
  });

  it("refuses a challenge for a revoked target", async () => {
    const harness = createHarness(verifiedRow({ verificationStatus: "REVOKED" }));

    await assert.rejects(harness.service.verificationChallenge("subject-1"), /revoked and cannot be verified/);
  });
});
