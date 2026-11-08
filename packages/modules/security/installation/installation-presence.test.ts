import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  isInstallationOnline,
  withDerivedOnlineState,
} from "./installation-presence";
import { ONLINE_THRESHOLD_SECONDS as HEARTBEAT_ONLINE_THRESHOLD_SECONDS } from "../../heartbeat/services/installation.service";
import { ONLINE_THRESHOLD_SECONDS as HEALTH_ONLINE_THRESHOLD_SECONDS } from "../../health/services/installation.service";
import { ONLINE_THRESHOLD_SECONDS as BACKEND_MONITOR_ONLINE_THRESHOLD_SECONDS } from "../../backend-monitor/services/monitor-installation.service";
import { ONLINE_THRESHOLD_SECONDS as MODULE_HUB_ONLINE_THRESHOLD_SECONDS } from "../../module-hub/services/installation.service";
import { ONLINE_THRESHOLD_SECONDS as WEB_MONITOR_ONLINE_THRESHOLD_SECONDS } from "../../web-monitor/services/web-installation.service";
import { WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS } from "../../work-evaluation/work-evaluation-installation.service";

/**
 * The online window is intentionally NOT uniform (ADR-019 consolidation).
 *
 * Heartbeat and health ask their controllers to ping every 30s, so three missed
 * intervals is 90s. The other collectors report roughly once a minute and keep
 * the shared 180s default. Pinning the split here stops a future "unify the
 * thresholds" cleanup from silently changing when a facility flips offline.
 */
describe("installation presence online windows", () => {
  it("keeps heartbeat/health at interval * 3 (90s)", () => {
    assert.equal(HEARTBEAT_ONLINE_THRESHOLD_SECONDS, 90);
    assert.equal(HEALTH_ONLINE_THRESHOLD_SECONDS, 90);
  });

  it("keeps the other collectors on the shared 180s default", () => {
    assert.equal(BACKEND_MONITOR_ONLINE_THRESHOLD_SECONDS, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS);
    assert.equal(MODULE_HUB_ONLINE_THRESHOLD_SECONDS, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS);
    assert.equal(WEB_MONITOR_ONLINE_THRESHOLD_SECONDS, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS);
    assert.equal(WORK_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS, DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS);
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
