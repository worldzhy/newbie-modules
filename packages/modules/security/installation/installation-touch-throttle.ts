/** Minimum interval between liveness UPDATEs for one installation. */
export const INSTALLATION_TOUCH_THROTTLE_MS = 30_000;

/**
 * Holds the last liveness touch per installation so callers can skip repeated
 * UPDATEs within {@link INSTALLATION_TOUCH_THROTTLE_MS}. The timestamp is
 * recorded only after the write resolves, so a failed write is retried on the
 * next report.
 */
export class InstallationTouchThrottle {
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly throttleMs = INSTALLATION_TOUCH_THROTTLE_MS) {}

  async runIfDue(installationId: string, touch: () => Promise<void>, nowMs = Date.now()): Promise<void> {
    if (nowMs - (this.lastTouchAt.get(installationId) ?? 0) < this.throttleMs) {
      return;
    }
    await touch();
    this.lastTouchAt.set(installationId, nowMs);
  }
}
