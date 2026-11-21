import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePenetrationTestingGate, insideMaintenanceWindow } from "./penetration-testing-gate";
import type { PenetrationTestingAuthorizationRecord } from "../authorization/penetration-testing-authorization.service";
import type { PenetrationTestingTestObjectRecord } from "../authorization/penetration-testing-test-object.service";

const now = new Date("2026-11-21T03:00:00.000Z");

function authorization(
  overrides: Partial<PenetrationTestingAuthorizationRecord> = {},
): PenetrationTestingAuthorizationRecord {
  return {
    id: "auth-1",
    subjectId: "subject-1",
    level: "L4",
    status: "APPROVED",
    roeDocumentRef: "doc-1",
    requestedBy: "alice",
    approvedBy: "bob",
    approvedAt: now,
    validFrom: new Date("2026-11-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-01T00:00:00.000Z"),
    allowedCidrs: [],
    findingId: null,
    attackClass: null,
    maintenanceWindow: {
      start: "2026-11-21T02:00:00.000Z",
      end: "2026-11-21T04:00:00.000Z",
      timezone: "UTC",
    },
    ...overrides,
  };
}

function testObject(overrides: Partial<PenetrationTestingTestObjectRecord> = {}): PenetrationTestingTestObjectRecord {
  return {
    id: "object-1",
    subjectId: "subject-1",
    kind: "RECORD",
    locator: { table: "orders", id: "42" },
    cleanupLocator: null,
    disposable: true,
    createdBy: "alice",
    approvedBy: "bob",
    approvedAt: now,
    expiresAt: new Date("2026-11-22T00:00:00.000Z"),
    ...overrides,
  };
}

const target = { environment: "NON_PRODUCTION", verificationStatus: "VERIFIED", isActive: true };

describe("penetration-testing gate", () => {
  it("rejects an unknown standard key instead of defaulting", () => {
    const decision = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "unknown",
      runConfig: {},
      target,
      authorization: authorization(),
      testObject: testObject(),
      activeStandardKeys: [],
      now,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "UNKNOWN_STANDARD_KEY");
  });

  it("rejects an inactive or unverified target", () => {
    const inactive = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "attack-surface",
      runConfig: {},
      target: { ...target, isActive: false },
      authorization: authorization({ level: "L1" }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(inactive.ok, false);
    if (!inactive.ok) assert.equal(inactive.reason, "TARGET_NOT_ACTIVE");

    const unverified = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "attack-surface",
      runConfig: {},
      target: { ...target, verificationStatus: "PENDING" },
      authorization: authorization({ level: "L1" }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(unverified.ok, false);
    if (!unverified.ok) assert.equal(unverified.reason, "TARGET_NOT_VERIFIED");
  });

  it("rejects a missing or expired authorization", () => {
    const missing = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "attack-surface",
      runConfig: {},
      target,
      authorization: null,
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.reason, "AUTHORIZATION_MISSING");

    const expired = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "attack-surface",
      runConfig: {},
      target,
      authorization: authorization({ level: "L1", validUntil: new Date("2026-11-20T00:00:00.000Z") }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "AUTHORIZATION_EXPIRED");
  });

  it("requires L3 to match the bound finding and attack class", () => {
    const mismatch = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "exploit-verification",
      runConfig: { findingId: "finding-2", attackClass: "sql-injection" },
      target,
      authorization: authorization({
        level: "L3",
        maintenanceWindow: null,
        findingId: "finding-1",
        attackClass: "sql-injection",
      }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, "AUTHORIZATION_FINDING_MISMATCH");

    const match = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "exploit-verification",
      runConfig: { findingId: "finding-1", attackClass: "sql-injection" },
      target,
      authorization: authorization({
        level: "L3",
        maintenanceWindow: null,
        findingId: "finding-1",
        attackClass: "sql-injection",
      }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(match.ok, true);
    if (match.ok) assert.equal(match.level, "L3");
  });

  it("refuses L4 on production, outside the window, or with another active run", () => {
    const production = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "sqli-write-proof", testObjectId: "object-1" },
      target: { ...target, environment: "PRODUCTION" },
      authorization: authorization(),
      testObject: testObject(),
      activeStandardKeys: [],
      now,
    });
    assert.equal(production.ok, false);
    if (!production.ok) assert.equal(production.reason, "L4_OUTSIDE_MAINTENANCE_WINDOW");

    const outside = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "sqli-write-proof", testObjectId: "object-1" },
      target,
      authorization: authorization({
        maintenanceWindow: {
          start: "2026-11-21T05:00:00.000Z",
          end: "2026-11-21T06:00:00.000Z",
          timezone: "UTC",
        },
      }),
      testObject: testObject(),
      activeStandardKeys: [],
      now,
    });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.reason, "L4_OUTSIDE_MAINTENANCE_WINDOW");

    const conflict = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "sqli-write-proof", testObjectId: "object-1" },
      target,
      authorization: authorization(),
      testObject: testObject(),
      activeStandardKeys: ["vulnerability-scan"],
      now,
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.reason, "ACTIVE_RUN_CONFLICT");
  });

  it("refuses a non-destructive run while L4 is active", () => {
    const decision = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "vulnerability-scan",
      runConfig: {},
      target,
      authorization: authorization({ level: "L2" }),
      testObject: null,
      activeStandardKeys: ["destructive-testing"],
      now,
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.reason, "ACTIVE_RUN_CONFLICT");
  });

  it("requires a known playbook and a matching disposable test object", () => {
    const unknownPlaybook = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "nope", testObjectId: "object-1" },
      target,
      authorization: authorization(),
      testObject: testObject(),
      activeStandardKeys: [],
      now,
    });
    assert.equal(unknownPlaybook.ok, false);
    if (!unknownPlaybook.ok) assert.equal(unknownPlaybook.reason, "PLAYBOOK_UNKNOWN");

    const wrongKind = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "upload-proof", testObjectId: "object-1" },
      target,
      authorization: authorization(),
      testObject: testObject({ kind: "RECORD" }),
      activeStandardKeys: [],
      now,
    });
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) assert.equal(wrongKind.reason, "TEST_OBJECT_KIND_MISMATCH");
  });

  it("admits a valid L4 action", () => {
    const decision = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "destructive-testing",
      runConfig: { playbookId: "sqli-write-proof", testObjectId: "object-1" },
      target,
      authorization: authorization(),
      testObject: testObject(),
      activeStandardKeys: [],
      now,
    });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      assert.equal(decision.level, "L4");
      assert.equal(decision.playbookId, "sqli-write-proof");
      assert.equal(decision.testObject?.id, "object-1");
    }
  });

  it("binds the authorization row to the run's subject and level", () => {
    const otherSubject = evaluatePenetrationTestingGate({
      subjectId: "subject-2",
      standardKey: "attack-surface",
      runConfig: {},
      target,
      authorization: authorization({ level: "L1" }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(otherSubject.ok, false);
    if (!otherSubject.ok) assert.equal(otherSubject.reason, "AUTHORIZATION_SUBJECT_MISMATCH");

    const otherLevel = evaluatePenetrationTestingGate({
      subjectId: "subject-1",
      standardKey: "vulnerability-scan",
      runConfig: {},
      target,
      authorization: authorization({ level: "L1" }),
      testObject: null,
      activeStandardKeys: [],
      now,
    });
    assert.equal(otherLevel.ok, false);
    if (!otherLevel.ok) assert.equal(otherLevel.reason, "AUTHORIZATION_LEVEL_MISMATCH");
  });

  it("evaluates absolute maintenance windows", () => {
    const window = { start: "2026-11-21T02:00:00.000Z", end: "2026-11-21T04:00:00.000Z" };
    assert.equal(insideMaintenanceWindow(window, now), true);
    assert.equal(insideMaintenanceWindow(window, new Date("2026-11-21T04:00:01.000Z")), false);
    assert.equal(insideMaintenanceWindow({ start: "bad", end: "worse" }, now), false);
  });
});
