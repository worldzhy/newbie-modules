import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRepositoryAccessible, REPOSITORY_STATUS_READY } from "./repository-access";

/**
 * Contract tests for the repository accessibility rule (ADR-008). Every
 * consumer (nightly scan, manual scan, copilot datasource, UI gating) relies
 * on this predicate — these cases are the single guard against silently
 * reverting to "repositoryUrl non-null means reachable".
 *
 * Run: `npm test` inside the container.
 */

describe("isRepositoryAccessible", () => {
  const url = "https://github.com/acme/atlas-api.git";

  it("is accessible for mode B (no provisioning lifecycle) with a URL", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: url, provisioningStatus: null }), true);
  });

  it("is accessible for mode A once READY", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: url, provisioningStatus: REPOSITORY_STATUS_READY }), true);
    assert.equal(isRepositoryAccessible({ repositoryUrl: url, provisioningStatus: "READY" }), true);
  });

  it("is NOT accessible while PROVISIONING even though the URL is persisted", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: url, provisioningStatus: "PROVISIONING" }), false);
  });

  it("is NOT accessible after FAILED — the URL may point at an external same-name repo", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: url, provisioningStatus: "FAILED" }), false);
  });

  it("is NOT accessible without a URL regardless of status", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: null, provisioningStatus: null }), false);
    assert.equal(isRepositoryAccessible({ repositoryUrl: null, provisioningStatus: "READY" }), false);
    assert.equal(isRepositoryAccessible({ repositoryUrl: null, provisioningStatus: "PROVISIONING" }), false);
    assert.equal(isRepositoryAccessible({ repositoryUrl: null, provisioningStatus: "FAILED" }), false);
  });

  it("treats an empty-string URL as absent", () => {
    assert.equal(isRepositoryAccessible({ repositoryUrl: "", provisioningStatus: "READY" }), false);
  });
});
