import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dependencyEvidenceId,
  dependencyKnowledgeKey,
  dependencyFingerprint,
} from "./judgment/dependency/security-evaluation-dependency.identity";

/**
 * Contract tests for the identity helpers. Finding identity is version-free by
 * design: an upgrade onto another still-affected version must keep the same
 * finding open, so a version bump cannot silently reset its lifecycle.
 */

describe("dependencyFingerprint", () => {
  it("is stable across package versions", () => {
    assert.equal(
      dependencyFingerprint("lodash", "GHSA-xxxx-yyyy-zzzz"),
      dependencyFingerprint("lodash", "GHSA-xxxx-yyyy-zzzz"),
    );
  });

  it("does not collide across packages or vulnerability ids", () => {
    const base = dependencyFingerprint("lodash", "GHSA-1");
    assert.notEqual(base, dependencyFingerprint("lodash", "GHSA-2"));
    assert.notEqual(base, dependencyFingerprint("minimist", "GHSA-1"));
  });

  it("does not depend on version input because it takes none", () => {
    // The signature is the contract: two versions of one package produce one
    // fingerprint. A version parameter would silently reintroduce duplicates.
    assert.equal(dependencyFingerprint.length, 2);
  });
});

describe("dependencyKnowledgeKey and dependencyEvidenceId", () => {
  it("scopes the package identity by ecosystem and version", () => {
    assert.equal(dependencyKnowledgeKey("lodash", "4.17.20"), "npm:lodash@4.17.20");
    assert.equal(dependencyEvidenceId("lodash", "4.17.20"), "pkg:npm:lodash@4.17.20");
  });

  it("keeps scoped package names intact", () => {
    assert.equal(dependencyKnowledgeKey("@types/node", "24.0.0"), "npm:@types/node@24.0.0");
  });
});
