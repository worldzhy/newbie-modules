import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluationFindingSeverity as PersistedEvaluationFindingSeverity } from "@generated/prisma/client";

import { PERSISTED_SEVERITY, toPersistedSeverity } from "./evaluation-severity.mapping";

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

  for (const contractValue of Object.keys(PERSISTED_SEVERITY)) {
    assert.equal(
      toPersistedSeverity(contractValue as keyof typeof PERSISTED_SEVERITY),
      contractValue,
      `severity "${contractValue}" must persist under its own name`,
    );
  }
});
