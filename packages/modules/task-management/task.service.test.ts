import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskStatus } from "@generated/prisma/enums";
import {
  canTransition,
  deriveDesignReviewRequired,
  evaluateAdmission,
  formatGateOneBlock,
  MAX_ALLOWED_PATHS,
  planEditRequiresOverride,
  requiresPlanOverrideAuthority,
} from "./task.service";

// ADR-054 D2/D4: gate 4 stops work in flight, so every in-flight state can block.
test("task status transitions: BLOCKED is entered from every in-flight state", () => {
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.DEVELOPING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.MERGED, TaskStatus.BLOCKED), true);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.BLOCKED), true);
});

test("task status transitions: BLOCKED leaves to DEVELOPING or CANCELLED", () => {
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.CANCELLED), true);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.PENDING), false);
  assert.equal(canTransition(TaskStatus.BLOCKED, TaskStatus.COMPLETED), false);
});

// ADR-003 D1: TESTING -> MERGED -> DEPLOYED -> COMPLETED is the only path to done.
test("task status transitions: delivery pipeline goes through MERGED", () => {
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.DEVELOPING, TaskStatus.TESTING), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.MERGED), true);
  assert.equal(canTransition(TaskStatus.MERGED, TaskStatus.DEPLOYED), true);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.COMPLETED), true);
  assert.equal(canTransition(TaskStatus.TESTING, TaskStatus.COMPLETED), false);
  assert.equal(canTransition(TaskStatus.MERGED, TaskStatus.COMPLETED), false);
});

test("task status transitions: rework and terminal states", () => {
  assert.equal(canTransition(TaskStatus.MERGED, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.DEPLOYED, TaskStatus.DEVELOPING), true);
  assert.equal(canTransition(TaskStatus.COMPLETED, TaskStatus.DEVELOPING), false);
  assert.equal(canTransition(TaskStatus.CANCELLED, TaskStatus.DEVELOPING), false);
  assert.equal(canTransition(TaskStatus.PENDING, TaskStatus.PENDING), true);
});

// ADR-054 D3 derivation: any single design-review signal is enough.
test("deriveDesignReviewRequired: several repositories require a design review", () => {
  assert.equal(deriveDesignReviewRequired({ repos: ["backend", "frontend"] }, []), true);
  assert.equal(deriveDesignReviewRequired({ repos: ["backend"] }, []), false);
});

test("deriveDesignReviewRequired: schema, contract and irreversible changes require a review", () => {
  assert.equal(deriveDesignReviewRequired({ touchesSchema: true }, []), true);
  assert.equal(deriveDesignReviewRequired({ touchesContracts: true }, []), true);
  assert.equal(deriveDesignReviewRequired({ irreversible: true }, []), true);
});

test("deriveDesignReviewRequired: more than 20 allowed path globs requires a review", () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `src/application/mod-${index}/**`);
  assert.equal(deriveDesignReviewRequired(undefined, twenty), false);
  assert.equal(deriveDesignReviewRequired(undefined, [...twenty, "src/application/extra/**"]), true);
});

test("deriveDesignReviewRequired: no plan does not require a review", () => {
  assert.equal(deriveDesignReviewRequired(null, []), false);
  assert.equal(deriveDesignReviewRequired(undefined, []), false);
});

const READY = {
  acceptanceCriteria: "GET /tasks returns the new field",
  parentId: null,
  designReference: null,
  designReviewRequired: false,
  allowedPaths: ["src/modules/task-management/**"],
  prerequisites: [],
  prerequisiteStatuses: new Map<string, TaskStatus>(),
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

test("evaluateAdmission: a design review needs a designReference, otherwise not", () => {
  assert.equal(evaluateAdmission({ ...READY, designReviewRequired: true }).admitted, false);
  assert.equal(evaluateAdmission({ ...READY, designReviewRequired: true, designReference: "ADR-054" }).admitted, true);
});

test("evaluateAdmission: allowedPaths must be non-empty and within the cap", () => {
  assert.equal(evaluateAdmission({ ...READY, allowedPaths: [] }).admitted, false);
  const overCap = Array.from({ length: MAX_ALLOWED_PATHS + 1 }, (_, index) => `src/mod${index}/**`);
  assert.deepEqual(evaluateAdmission({ ...READY, allowedPaths: overCap }).violations, [
    `allowedPaths has ${MAX_ALLOWED_PATHS + 1} entries; at most ${MAX_ALLOWED_PATHS} are allowed`,
  ]);
});

test("evaluateAdmission: prerequisites must exist and be COMPLETED", () => {
  const statuses = new Map<string, TaskStatus>([
    ["done", TaskStatus.COMPLETED],
    ["busy", TaskStatus.DEVELOPING],
  ]);
  assert.deepEqual(evaluateAdmission({ ...READY, prerequisites: ["done"], prerequisiteStatuses: statuses }), {
    admitted: true,
    violations: [],
  });

  const verdict = evaluateAdmission({
    ...READY,
    prerequisites: ["busy", "missing"],
    prerequisiteStatuses: statuses,
  });
  assert.deepEqual(verdict.violations, [
    "prerequisite task busy is DEVELOPING, not COMPLETED",
    "prerequisite task missing does not exist",
  ]);
});

test("formatGateOneBlock: prefixes the violations with the gate number", () => {
  assert.equal(formatGateOneBlock(["a", "b"]), "gate 1: a; b");
});

// ADR-054 D3 freeze: changeImpact / allowedPaths are only editable through
// override once the plan froze.
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
