import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapOsvSeverity } from "./judgment/security-evaluation-severity";
import { deriveExposure, deriveUrgency, deriveUrgencyRank } from "./judgment/security-evaluation-urgency";

/**
 * Contract tests for the urgency derivation: a deterministic function of
 * severity and exposure (ADR-022 D5), never a composite score. Development-only
 * exposure earns one band of relief; unknown exposure earns none.
 */

describe("deriveExposure", () => {
  it("maps the dev flag onto the exposure vocabulary", () => {
    assert.equal(deriveExposure(true), "development");
    assert.equal(deriveExposure(false), "production");
  });

  it("keeps a missing dev flag at unknown rather than guessing production", () => {
    assert.equal(deriveExposure(undefined), "unknown");
    assert.equal(deriveExposure("false"), "unknown");
  });
});

describe("deriveUrgency", () => {
  it("maps severity onto the production bands", () => {
    assert.equal(deriveUrgency("CRITICAL", "production"), "P1");
    assert.equal(deriveUrgency("HIGH", "production"), "P2");
    assert.equal(deriveUrgency("MEDIUM", "production"), "P3");
    assert.equal(deriveUrgency("LOW", "production"), "P4");
    assert.equal(deriveUrgency("INFO", "production"), "P4");
  });

  it("grants exactly one band of relief for development-only exposure", () => {
    assert.equal(deriveUrgency("CRITICAL", "development"), "P2");
    assert.equal(deriveUrgency("HIGH", "development"), "P3");
    assert.equal(deriveUrgency("MEDIUM", "development"), "P4");
    assert.equal(deriveUrgency("LOW", "development"), "P4");
  });

  it("never downgrades an unknown exposure", () => {
    assert.equal(deriveUrgency("HIGH", "unknown"), deriveUrgency("HIGH", "production"));
  });

  it("never pushes a band past P4", () => {
    for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
      for (const exposure of ["production", "development", "unknown"] as const) {
        assert.match(deriveUrgency(severity, exposure), /^P[1-4]$/);
      }
    }
  });
});

describe("deriveUrgencyRank", () => {
  it("orders P1 above P4", () => {
    assert.ok(deriveUrgencyRank("P1") > deriveUrgencyRank("P2"));
    assert.ok(deriveUrgencyRank("P2") > deriveUrgencyRank("P3"));
    assert.ok(deriveUrgencyRank("P3") > deriveUrgencyRank("P4"));
  });
});

describe("mapOsvSeverity", () => {
  it("normalises the OSV severity vocabulary", () => {
    assert.deepEqual(mapOsvSeverity("moderate"), { severity: "MEDIUM", source: "database_specific" });
    assert.deepEqual(mapOsvSeverity("HIGH"), { severity: "HIGH", source: "database_specific" });
    assert.deepEqual(mapOsvSeverity("none"), { severity: "INFO", source: "database_specific" });
  });

  it("reports a missing or unrecognised severity as INFO from an unknown source", () => {
    assert.deepEqual(mapOsvSeverity(undefined), { severity: "INFO", source: "unknown" });
    assert.deepEqual(mapOsvSeverity("CVSS:3.1/AV:N"), { severity: "INFO", source: "unknown" });
  });
});
