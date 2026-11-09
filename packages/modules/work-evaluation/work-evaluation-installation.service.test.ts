import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS } from "./work-evaluation-installation.service";

/**
 * work-evaluation agents report on the default cadence, so they keep the shared
 * 180s window (ADR-019). The window is owned here; the shared presence helper
 * must not be consulted for it (round 27, P2-3 moved this out of the security
 * package).
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "work-evaluation-installation.service.ts"), "utf8");

test("work-evaluation keeps the 180s default window", () => {
  assert.equal(WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS, 180);
});

test("every work-evaluation presence call site passes that window", () => {
  assert.ok(
    SERVICE_SOURCE.includes("withDerivedOnlineState(row, WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS)"),
  );
});
