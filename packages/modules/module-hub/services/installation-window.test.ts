import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ONLINE_THRESHOLD_SECONDS } from "./installation.service";

/**
 * module-hub installations report on the default cadence, so they keep the
 * shared 180s window (ADR-019). The window is owned here; the shared presence
 * helper must not be consulted for it (round 27, P2-3 moved this out of the
 * security package). Since ADR-078 presence is read from the shared
 * `Installation` row's `lastSeenAt`.
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "installation.service.ts"), "utf8");

test("module-hub keeps the 180s default window", () => {
  assert.equal(ONLINE_THRESHOLD_SECONDS, 180);
});

test("every module-hub presence call site passes that window", () => {
  assert.ok(SERVICE_SOURCE.includes("Date.now() - installation.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS"));
  assert.ok(SERVICE_SOURCE.includes("isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)"));
});
