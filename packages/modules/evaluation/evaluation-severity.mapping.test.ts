import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationFindingSeverity as PersistedEvaluationFindingSeverity } from "@generated/prisma/client";

import { PERSISTED_SEVERITY, toPersistedSeverity } from "./evaluation-severity.mapping";
import { SEVERITIES } from "./evaluation-severity.util";

/**
 * Drift gate for the two severity vocabularies (ADR-020 D4): the contract union
 * is the type source of truth and the Prisma enum mirrors it. The mapping is
 * exhaustive at compile time; this test covers the other direction — an enum
 * value added without a contract counterpart — and pins that names are equal.
 */
test("contract severity union and persisted enum stay in step", () => {
  assert.deepEqual(
    Object.keys(PERSISTED_SEVERITY).sort(),
    Object.keys(PersistedEvaluationFindingSeverity).sort(),
    "the contract union and the Prisma enum must carry exactly the same values",
  );

  // The runtime tuple feeds isSeverity() and notification derivation; a member
  // omitted here silently narrows the accepted vocabulary at runtime, which the
  // SeverityTupleIsExhaustive type guard catches at compile time and this
  // assertion catches in the drift test.
  assert.deepEqual(
    [...SEVERITIES].sort(),
    Object.keys(PERSISTED_SEVERITY).sort(),
    "SEVERITIES must list exactly the contract union values",
  );

  for (const contractValue of Object.keys(PERSISTED_SEVERITY)) {
    assert.equal(
      toPersistedSeverity(contractValue as keyof typeof PERSISTED_SEVERITY),
      contractValue,
      `severity "${contractValue}" must persist under its own name`,
    );
  }
});
