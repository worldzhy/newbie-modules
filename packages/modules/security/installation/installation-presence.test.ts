import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  isInstallationOnline,
  withDerivedOnlineState,
} from "./installation-presence";

/**
 * Shared presence primitives (ADR-019).
 *
 * The online window is deliberately NOT uniform and is owned by each collector:
 * heartbeat and health pass 90s (30s ping * 3), the roughly-once-a-minute
 * collectors pass the 180s default. Those per-call-site assertions live in the
 * owning feature modules so this package stays self-contained (its manifest
 * only requires "redis"); here we only pin the helper's own contract.
 */
describe("installation presence online windows", () => {
  it("defaults the window to 180 seconds", () => {
    assert.equal(DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS, 180);
  });

  it("treats a contact exactly at the window as online, one millisecond past as offline", () => {
    const nowMs = Date.UTC(2026, 0, 1);
    const atWindow = new Date(nowMs - 180_000);
    const pastWindow = new Date(nowMs - 180_001);
    assert.equal(isInstallationOnline(atWindow, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS, nowMs), true);
    assert.equal(isInstallationOnline(pastWindow, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS, nowMs), false);
    // A faster collector uses the same boundary with its own window.
    assert.equal(isInstallationOnline(atWindow, 90, nowMs), false);
  });

  it("derives online from last contact and revocation, stripping the token hash", () => {
    const nowMs = Date.now();
    const fresh = withDerivedOnlineState(
      { revokedAt: null, lastSeenAt: new Date(nowMs - 60_000), tokenHash: "hash", id: "a" },
      DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
    );
    assert.equal(fresh.online, true);
    assert.equal("tokenHash" in fresh, false);

    const revoked = withDerivedOnlineState({
      revokedAt: new Date(nowMs - 1_000),
      lastSeenAt: new Date(nowMs - 60_000),
      tokenHash: "hash",
      id: "b",
    });
    assert.equal(revoked.online, false);
  });
});
