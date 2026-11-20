import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PenetrationTestingCriteriaProvider } from "./penetration-testing-criteria.provider";
import type { PenetrationTestingCriteriaSeed } from "./penetration-testing-criteria.seed";

const seed = { seedAll: async () => undefined } as unknown as PenetrationTestingCriteriaSeed;
const provider = new PenetrationTestingCriteriaProvider(seed);
const subject = {
  id: "subject-1",
  subjectType: "penetration-testing",
  kind: "web-target",
  subjectKey: "https://example.com",
  displayName: "Example",
};

describe("PenetrationTestingCriteriaProvider", () => {
  it("selects a rule set from the run config key", async () => {
    for (const standardKey of ["attack-surface", "vulnerability-scan", "exploit-verification", "destructive-testing"]) {
      const selection = await provider.selectVersion(subject, { standardKey });
      assert.deepEqual(selection, { standardKey, version: "v1" });
    }
  });

  it("returns null for a missing or unknown key instead of guessing", async () => {
    assert.equal(await provider.selectVersion(subject, {}), null);
    assert.equal(await provider.selectVersion(subject, { standardKey: "nope" }), null);
    assert.equal(await provider.selectVersion(subject, null), null);
  });

  it("returns null for a different subject kind", async () => {
    assert.equal(
      await provider.selectVersion({ ...subject, kind: "web-origin" }, { standardKey: "attack-surface" }),
      null,
    );
  });
});
