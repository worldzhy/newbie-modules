import { Injectable } from "@nestjs/common";
import { RedisService } from "@modules/redis/redis.service";
import { InstallationBudgetWindow } from "./installation-kind";
import { RateLimiter } from "../rate-limiter/rate-limiter.service";

/**
 * Executes the two-layer installation budget declared by a kind descriptor
 * (ADR-079). It holds no per-kind values: the descriptor is the only source.
 *
 * Both layers reuse {@link RateLimiter}, whose Redis path is a single atomic
 * script: the counter is incremented and its TTL is set in one round trip, so
 * a crash can never leave an immortal bucket that pins a key to 429.
 */
@Injectable()
export class InstallationBudgetService {
  private readonly limiters = new Map<string, RateLimiter>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Spend one point in a window. Returns false when the quota is exhausted.
   * A `total` window is keyed by installation id; a `key` window by the
   * descriptor's scope (token hash, optionally plus source IP).
   */
  async spend(
    kind: string,
    layer: "key" | "total",
    subject: string,
    window: InstallationBudgetWindow,
  ): Promise<boolean> {
    const remaining = await this.limiter(kind, layer, window).spend(subject);
    return remaining >= 0;
  }

  private limiter(kind: string, layer: "key" | "total", window: InstallationBudgetWindow): RateLimiter {
    const cacheKey = `${kind}:${layer}`;
    let limiter = this.limiters.get(cacheKey);
    if (!limiter) {
      limiter = RateLimiter.fromRedis(
        this.redis,
        {
          keyPrefix: `installation-budget-${kind}-${layer}-`,
          points: window.points,
          duration: window.durationSeconds,
        },
        `InstallationBudget(${kind}/${layer})`,
      );
      this.limiters.set(cacheKey, limiter);
    }
    return limiter;
  }
}
