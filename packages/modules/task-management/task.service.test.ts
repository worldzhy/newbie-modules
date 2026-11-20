import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskChangeClass, TaskStatus } from "@generated/prisma/enums";
import {
  canTransition,
  deriveChangeClass,
  evaluateAdmission,
  formatGateOneBlock,
  MAX_SCOPE_PATHS,
  planEditRequiresOverride,
  requiresPlanOverrideAuthority,
} from "./task.service";

// ADR-054 D2/D4: gate 4 stops work in flight, so TESTING and DEPLOYED can block too.
test("task status transitions: BLOCKED is entered from every in-flight state", () => {
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.DEVELOPING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.BLOCKED), true);
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

const READY = {
  acceptanceCriteria: "GET /tasks returns the new field",
  parentId: null,
  designRef: null,
  changeClass: TaskChangeClass.SIMPLE,
  scopePaths: ["src/modules/task-management/**"],
  dependsOn: [],
  dependencyStatuses: new Map<string, TaskStatus>(),
};

// ADR-054 D4 gate 1: every rule is reported, not just the first one.
test("evaluateAdmission: a well-formed task is admitted", () => {
  assert.deepEqual(evaluateAdmission(READY), { admitted: true, violations: [] });
});

test("evaluateAdmission: acceptance criteria is mandatory", () => {
  const verdict = evaluateAdmission({ ...READY, acceptanceCriteria: "   " });
  assert.equal(verdict.admitted, false);
  assert.deepEqual(verdict.violations, ["acceptanceCriteria is required before a task can start"]);
});

test("evaluateAdmission: a design unit never starts", () => {
  const verdict = evaluateAdmission({ ...READY, parentId: "ckv1parent" });
  assert.equal(verdict.admitted, false);
  assert.deepEqual(verdict.violations, ["a design-unit task (parentId set) cannot start"]);
});

test("evaluateAdmission: DESIGNED needs a designRef, SIMPLE does not", () => {
  assert.equal(evaluateAdmission({ ...READY, changeClass: TaskChangeClass.DESIGNED }).admitted, false);
  assert.equal(
    evaluateAdmission({ ...READY, changeClass: TaskChangeClass.DESIGNED, designRef: "ADR-054" }).admitted,
    true,
  );
});

test("evaluateAdmission: scopePaths must be non-empty and within the cap", () => {
  assert.equal(evaluateAdmission({ ...READY, scopePaths: [] }).admitted, false);
  const overCap = Array.from({ length: MAX_SCOPE_PATHS + 1 }, (_, index) => `src/mod${index}/**`);
  assert.deepEqual(evaluateAdmission({ ...READY, scopePaths: overCap }).violations, [
    `scopePaths has ${MAX_SCOPE_PATHS + 1} entries; at most ${MAX_SCOPE_PATHS} are allowed`,
  ]);
});

test("evaluateAdmission: dependencies must exist and be COMPLETED", () => {
  const statuses = new Map<string, TaskStatus>([
    ["done", TaskStatus.COMPLETED],
    ["busy", TaskStatus.DEVELOPING],
  ]);
  assert.deepEqual(evaluateAdmission({ ...READY, dependsOn: ["done"], dependencyStatuses: statuses }), {
    admitted: true,
    violations: [],
  });

  const verdict = evaluateAdmission({
    ...READY,
    dependsOn: ["busy", "missing"],
    dependencyStatuses: statuses,
  });
  assert.deepEqual(verdict.violations, [
    "dependency busy is DEVELOPING, not COMPLETED",
    "dependency missing does not exist",
  ]);
});

test("formatGateOneBlock: prefixes the violations with the gate number", () => {
  assert.equal(formatGateOneBlock(["a", "b"]), "gate 1: a; b");
});

// ADR-054 D3 freeze: impact / scopePaths are only editable through override
// once the plan froze.
test("planEditRequiresOverride: only a frozen plan blocks edits", () => {
  assert.equal(planEditRequiresOverride(null, true), false);
  assert.equal(planEditRequiresOverride(undefined, true), false);
  assert.equal(planEditRequiresOverride(new Date("2026-11-19T00:00:00Z"), false), false);
  assert.equal(planEditRequiresOverride(new Date("2026-11-19T00:00:00Z"), true), true);
});

// ADR-054 D3: the override authority is a separate atom, so `Task:Update` alone
// cannot rewrite a frozen plan or pre-fill the gate-1 justification.
test("requiresPlanOverrideAuthority: frozen plan edits and new justifications", () => {
  const frozen = new Date("2026-11-19T00:00:00Z");
  assert.equal(requiresPlanOverrideAuthority(frozen, true, {}), true);
  assert.equal(requiresPlanOverrideAuthority(null, false, { incoming: "private repo" }), true);
  assert.equal(
    requiresPlanOverrideAuthority(null, false, { incoming: "private repo", stored: "another reason" }),
    true,
  );
  assert.equal(requiresPlanOverrideAuthority(frozen, false, {}), false);
  assert.equal(requiresPlanOverrideAuthority(null, false, { incoming: "   " }), false);
  assert.equal(requiresPlanOverrideAuthority(null, false, { incoming: "same", stored: "same" }), false);
});
