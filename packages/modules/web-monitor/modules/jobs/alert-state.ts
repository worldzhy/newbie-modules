/**
 * Redis-backed alert lifecycle state machine (ADR-051). Extracted from
 * JobsService so the fail-open / fail-closed branches can be exercised with a
 * fake Redis instead of a text assertion over the service source (R20-09).
 */

/** Stored lifecycle state for one alert identity (appKey + signal). */
export interface AlertState {
  status: "firing";
  firstFiredAt: string;
  lastFiredAt: string;
  cleanWindows: number;
}

/** Minimal Redis surface the state machine needs. */
export interface AlertStateRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expirationMode: "EX", ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface AlertStateRedis {
  isConfigured(): boolean;
  getClient(): AlertStateRedisClient;
}

export interface AlertStateLogger {
  warn(message: string): void;
}

// A firing notification is suppressed inside the cooldown window; a signal
// that stays clean for N consecutive windows emits one recovered notification
// and clears its state.
export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
export const ALERT_RECOVERY_WINDOWS = 2;
// State TTL comfortably exceeds the cooldown so a slow-bleeding signal keeps
// its state between evaluations, but not forever.
export const ALERT_STATE_TTL_SECONDS = 2 * 60 * 60;

export class AlertStateMachine {
  constructor(
    private readonly redis: AlertStateRedis,
    private readonly logger: AlertStateLogger,
  ) {}

  /**
   * Returns true when a firing notification should be emitted now. Fails open
   * when Redis is not configured or a command fails: alerts must never go
   * silent during a Redis outage, and downstream minute-bucket deduplication
   * limits the repeat rate.
   */
  async shouldFire(key: string): Promise<boolean> {
    if (!this.redis.isConfigured()) return true;
    const client = this.redis.getClient();
    const now = Date.now();
    try {
      const raw = await client.get(key);
      if (raw) {
        const state = JSON.parse(raw) as AlertState;
        if (now - new Date(state.lastFiredAt).getTime() < ALERT_COOLDOWN_MS) {
          // Inside cooldown: keep the state alive, do not re-notify.
          state.lastFiredAt = new Date(now).toISOString();
          state.cleanWindows = 0;
          await client.set(key, JSON.stringify(state), "EX", ALERT_STATE_TTL_SECONDS);
          return false;
        }
        // Cooldown elapsed: re-ignite. Reachable only after an evaluation gap
        // >= cooldown while the state key survives (TTL 2h) — a continuously
        // breaching signal refreshes lastFiredAt every window above and never
        // reaches this branch.
        state.lastFiredAt = new Date(now).toISOString();
        state.cleanWindows = 0;
        await client.set(key, JSON.stringify(state), "EX", ALERT_STATE_TTL_SECONDS);
        return true;
      }
      const state: AlertState = {
        status: "firing",
        firstFiredAt: new Date(now).toISOString(),
        lastFiredAt: new Date(now).toISOString(),
        cleanWindows: 0,
      };
      await client.set(key, JSON.stringify(state), "EX", ALERT_STATE_TTL_SECONDS);
      return true;
    } catch (error) {
      this.logger.warn(`Alert state read/write failed for ${key}, firing without cooldown: ${messageOf(error)}`);
      return true;
    }
  }

  /**
   * Called on a clean window. Returns true once the signal has stayed clean for
   * ALERT_RECOVERY_WINDOWS consecutive windows. Fails closed when Redis is
   * unavailable: never claim "recovered" while the firing state cannot be
   * confirmed.
   */
  async recoverIfClean(key: string): Promise<boolean> {
    if (!this.redis.isConfigured()) return false;
    const client = this.redis.getClient();
    try {
      const raw = await client.get(key);
      if (!raw) return false;
      const state = JSON.parse(raw) as AlertState;
      state.cleanWindows += 1;
      if (state.cleanWindows >= ALERT_RECOVERY_WINDOWS) {
        await client.del(key);
        return true;
      }
      await client.set(key, JSON.stringify(state), "EX", ALERT_STATE_TTL_SECONDS);
      return false;
    } catch (error) {
      this.logger.warn(`Alert state read/write failed for ${key}, skipping recovery check: ${messageOf(error)}`);
      return false;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
