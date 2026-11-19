import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskChangeClass, TaskStatus } from "@generated/prisma/enums";
import { canTransition, deriveChangeClass } from "./task.service";

// ADR-054 D2 fixed transition table. The same status is a permitted no-op.
test("task status transitions: BLOCKED is entered from PENDING and DEVELOPING only", () => {
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.DEVELOPING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.BLOCKED), false);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.BLOCKED), false);
});

test("task status transitions: BLOCKED leaves to DEVELOPING or CANCELLED", () => {
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.CANCELLED), true);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.PENDING), false);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.COMPLETED), false);
});

test("task status transitions: existing edges and terminal states are unchanged", () => {
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.DEVELOPING, TaskStatus.TESTING), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.COMPLETED), true);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.COMPLETED), true);
  assert.equal(canTransition(TaskStatus.COMPLETED, TaskStatus.DEVELOPING), false);
  assert.equal(canTransition(TaskStatus.CANCELLED, TaskStatus.DEVELOPING), false);
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.PENDING), true);
});

// ADR-054 D3 derivation: any single DESIGNED signal is enough.
test("deriveChangeClass: DESIGNED when the impact declares several repos", () => {
  assert.equal(deriveChangeClass({ repos: ["backend", "frontend"] }, []), TaskChangeClass.DESIGNED);
  assert.equal(deriveChangeClass({ repos: ["backend"] }, []), TaskChangeClass.SIMPLE);
});

test("deriveChangeClass: DESIGNED for schema, contract and irreversible changes", () => {
  assert.equal(deriveChangeClass({ touchesSchema: true }, []), TaskChangeClass.DESIGNED);
  assert.equal(deriveChangeClass({ touchesContracts: true }, []), TaskChangeClass.DESIGNED);
  assert.equal(deriveChangeClass({ irreversible: true }, []), TaskChangeClass.DESIGNED);
});

test("deriveChangeClass: more than 20 allowed path globs is DESIGNED", () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `src/application/mod-${index}/**`);
  assert.equal(deriveChangeClass(undefined, twenty), TaskChangeClass.SIMPLE);
  assert.equal(deriveChangeClass(undefined, [...twenty, "src/application/extra/**"]), TaskChangeClass.DESIGNED);
});

test("deriveChangeClass: no plan is SIMPLE", () => {
  assert.equal(deriveChangeClass(null, []), TaskChangeClass.SIMPLE);
  assert.equal(deriveChangeClass(undefined, []), TaskChangeClass.SIMPLE);
});
