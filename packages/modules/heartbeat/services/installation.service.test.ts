import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ONLINE_THRESHOLD_SECONDS } from "./installation.service";

/**
 * Heartbeat asks its controllers to ping every 30s, so three missed intervals
 * is 90s (ADR-019). The window is owned here; the shared presence helper must
 * not be consulted for it (round 27, P2-3 moved this out of the security
 * package).
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "installation.service.ts"), "utf8");

test("heartbeat keeps the 90s window implied by its 30s ping interval", () => {
  assert.equal(ONLINE_THRESHOLD_SECONDS, 90);
});

test("every heartbeat presence call site passes that window", () => {
  assert.ok(SERVICE_SOURCE.includes("isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)"));
  assert.ok(SERVICE_SOURCE.includes("withDerivedOnlineState(row, ONLINE_THRESHOLD_SECONDS)"));
  assert.ok(SERVICE_SOURCE.includes("Date.now() - ONLINE_THRESHOLD_MILLISECONDS"));
});
