/**
 * Online-window primitives shared by the installation collectors (ADR-019).
 *
 * Every collector answers the same two questions — "is this row still
 * reporting?" and "how do several rows sharing one externalRef aggregate into
 * one presence?" — and every one of them used to spell that logic out again.
 * The window itself is NOT shared: a collector's cadence decides it. Heartbeat
 * and health ping every 30s and pass `interval * 3` (90s) explicitly; the
 * roughly-once-a-minute collectors inherit the default 180s. That split is
 * deliberate — see installation-presence.test.ts.
 */

/** Default online window for collectors that report roughly every 60s. */
export const DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS = 180;

/**
 * Presence of the installations sharing one externalRef, normalized for the
 * platform-side per-facility dashboards. Several rows can share a ref (rotation
 * history, multiple instances):
 * - `enrolled` — at least one non-revoked installation exists.
 * - `online` — a non-revoked installation reported within the online window.
 * - `lastSeenAt` — newest report across the non-revoked installations
 *   (null until the first contact).
 * - `revokedOnly` — rows exist but every one is revoked.
 */
export interface InstallationPresence {
  enrolled: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  revokedOnly: boolean;
}

/**
 * True when `lastSeenAt` falls inside the online window ending at `nowMs`.
 * A missing timestamp means the installation never reported.
 */
export function isInstallationOnline(
  lastSeenAt: Date | null,
  thresholdSeconds: number = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  return lastSeenAt != null && nowMs - new Date(lastSeenAt).getTime() <= thresholdSeconds * 1000;
}

/**
 * Strip the credential hash and derive the `online` flag for one installation
 * row. Revoked rows are never online regardless of their last contact.
 */
export function withDerivedOnlineState<
  T extends { revokedAt: Date | null; lastSeenAt: Date | null; tokenHash: string },
>(
  row: T,
  thresholdSeconds: number = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
): Omit<T, "tokenHash"> & { online: boolean } {
  const online = !row.revokedAt && isInstallationOnline(row.lastSeenAt, thresholdSeconds);
  const { tokenHash: _tokenHash, ...rest } = row;
  return { ...rest, online };
}
