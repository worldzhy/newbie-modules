import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ONLINE_THRESHOLD_SECONDS } from "./monitor-installation.service";

/**
 * backend-monitor batches probes roughly once a minute, so it keeps the shared
 * 180s window (ADR-019). The window is owned here; the shared presence helper
 * must not be consulted for it (round 27, P2-3 moved this out of the security
 * package).
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "monitor-installation.service.ts"), "utf8");

test("backend-monitor keeps the 180s default window", () => {
  assert.equal(ONLINE_THRESHOLD_SECONDS, 180);
});

test("every backend-monitor presence call site passes that window", () => {
  assert.ok(SERVICE_SOURCE.includes("withDerivedOnlineState(row, ONLINE_THRESHOLD_SECONDS)"));
  assert.ok(SERVICE_SOURCE.includes("isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)"));
});
