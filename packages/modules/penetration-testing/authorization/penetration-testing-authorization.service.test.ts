import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { PenetrationTestingAuthorizationService, normalizeCidrs } from "./penetration-testing-authorization.service";

const VALID_CIDRS = [
  "93.184.216.0/24",
  "10.0.0.0/8",
  "2001:db8::/32",
  "0.0.0.0/0",
  "::/0",
  "93.184.216.34",
  "2001:db8::1",
];

const INVALID_CIDRS = [
  "",
  "not-a-cidr",
  "10.0.0.0/33",
  "2001:db8::/129",
  "10.0.0.0/-1",
  "10.0.0.0/1.5",
  "10.0.0.0/",
  "300.1.1.1/24",
  "/24",
];

function accepts(run: () => unknown): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

interface AuthorizationRow {
  id: string;
  subjectId: string;
  level: string;
  status: string;
  roeDocumentRef: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  validFrom: Date;
  validUntil: Date;
  allowedCidrs: string[];
  findingId: string | null;
  attackClass: string | null;
  maintenanceWindow: null;
}

function harness(requestedBy = "alice", status = "PENDING") {
  let row: AuthorizationRow = {
    id: "auth-1",
    subjectId: "subject-1",
    level: "L2",
    status,
    roeDocumentRef: "doc-1",
    requestedBy,
    approvedBy: null,
    approvedAt: null,
    validFrom: new Date("2026-11-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-01T00:00:00.000Z"),
    allowedCidrs: [],
    findingId: null,
    attackClass: null,
    maintenanceWindow: null,
  };
  let lastListWhere: Record<string, unknown> | undefined;
  const prisma = {
    penetrationTestingAuthorization: {
      findUnique: async () => ({ ...row }),
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        lastListWhere = where;
        return [{ ...row }];
      },
      update: async ({ data }: { data: Partial<AuthorizationRow> }) => {
        row = { ...row, ...data };
        return { ...row };
      },
    },
  } as unknown as PrismaService;
  return {
    service: new PenetrationTestingAuthorizationService(prisma),
    current: () => row,
    lastListFilter: () => lastListWhere,
  };
}

describe("penetration-testing authorization", () => {
  it("accepts valid CIDRs and rejects malformed ones at request time", () => {
    for (const cidr of VALID_CIDRS) {
      assert.deepEqual(normalizeCidrs([cidr]), [cidr], cidr);
    }
    for (const cidr of INVALID_CIDRS) {
      assert.throws(() => normalizeCidrs([cidr]), /allowedCidrs/, cidr);
    }
  });

  it("keeps the module and runner CIDR parsers aligned", async () => {
    const runner = (await import(
      ["..", "..", "..", "..", "deploy", "penetration-runner", "snapshot.mjs"].join("/")
    )) as { normalizeCidrs: (cidrs: string[]) => string[] };

    for (const cidr of [...VALID_CIDRS, ...INVALID_CIDRS]) {
      assert.equal(
        accepts(() => normalizeCidrs([cidr])),
        accepts(() => runner.normalizeCidrs([cidr])),
        `module and runner disagree on '${cidr}'`,
      );
    }
  });

  it("lists authorizations with the requested filters", async () => {
    const approved = harness("bob", "APPROVED");

    const records = await approved.service.list({ subjectId: "subject-1", level: "L2", status: "APPROVED" });

    assert.equal(records.length, 1);
    assert.equal(records[0].id, "auth-1");
    assert.deepEqual(approved.lastListFilter(), { subjectId: "subject-1", level: "L2", status: "APPROVED" });
  });

  it("requires the operator identity to come from a session", async () => {
    const { service } = harness();
    await assert.rejects(service.approve("auth-1", { id: "bob", via: "body" } as never), /must be "session"/);
  });

  it("keeps separation of duties between the requester and the approver", async () => {
    const selfApproval = harness();
    await assert.rejects(
      selfApproval.service.approve("auth-1", { id: "alice", via: "session" }),
      /cannot approve their own/,
    );
    assert.equal(selfApproval.current().status, "PENDING");

    const approved = harness();
    const record = await approved.service.approve("auth-1", { id: "bob", via: "session" });
    assert.equal(record.status, "APPROVED");
    assert.equal(record.approvedBy, "bob");
  });
});
