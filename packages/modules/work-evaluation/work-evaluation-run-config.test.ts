import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readBudgetOverride, readPeriodId, readScopeOverride, requirePeriodId } from "./work-evaluation-run-config";

describe("readPeriodId", () => {
  it("returns null when the key is absent", () => {
    assert.equal(readPeriodId(null), null);
    assert.equal(readPeriodId(undefined), null);
    assert.equal(readPeriodId({}), null);
    assert.equal(readPeriodId({ periodId: null }), null);
  });

  it("returns the period id", () => {
    assert.equal(readPeriodId({ periodId: "period-1" }), "period-1");
  });

  it("fails fast on a present but non-string period id", () => {
    assert.throws(() => readPeriodId({ periodId: 42 }), /must be a non-empty string/);
    assert.throws(() => readPeriodId({ periodId: "  " }), /must be a non-empty string/);
  });
});

describe("requirePeriodId", () => {
  it("fails fast when the key is absent", () => {
    assert.throws(() => requirePeriodId(null), /is required/);
    assert.throws(() => requirePeriodId({}), /is required/);
  });
});

describe("readScopeOverride", () => {
  it("falls back to the feature default when absent", () => {
    assert.equal(readScopeOverride(null), undefined);
    assert.equal(readScopeOverride({}), undefined);
    assert.equal(readScopeOverride({ modelScope: null }), undefined);
  });

  it("returns the requested scope", () => {
    assert.equal(readScopeOverride({ modelScope: "kimi-k3" }), "kimi-k3");
  });

  it("fails fast on a present but invalid scope", () => {
    assert.throws(() => readScopeOverride({ modelScope: 7 }), /must be a non-empty string/);
    assert.throws(() => readScopeOverride({ modelScope: "" }), /must be a non-empty string/);
  });
});

describe("readBudgetOverride", () => {
  it("falls back to the phase defaults when absent", () => {
    assert.deepEqual(readBudgetOverride(null), {});
    assert.deepEqual(readBudgetOverride({}), {});
    assert.deepEqual(readBudgetOverride({ budget: null }), {});
  });

  it("overrides only the phases that are present", () => {
    assert.deepEqual(readBudgetOverride({ budget: { advocate: 1200 } }), { advocate: 1200 });
    assert.deepEqual(readBudgetOverride({ budget: { skeptic: null } }), {});
  });

  it("fails fast on a malformed budget object", () => {
    assert.throws(() => readBudgetOverride({ budget: "big" }), /must be an object/);
    assert.throws(() => readBudgetOverride({ budget: [1200] }), /must be an object/);
  });

  it("fails fast on present but invalid phase values", () => {
    assert.throws(() => readBudgetOverride({ budget: { advocate: "big" } }), /budget\.advocate/);
    assert.throws(() => readBudgetOverride({ budget: { skeptic: -1 } }), /budget\.skeptic/);
    assert.throws(() => readBudgetOverride({ budget: { synthesis: 0 } }), /budget\.synthesis/);
  });
});
