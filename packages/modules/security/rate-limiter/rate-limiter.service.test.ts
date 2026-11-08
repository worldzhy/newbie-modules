import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RedisService } from "@modules/redis/redis.service";
import { SECURITY_RATE_LIMITER } from "../security-config.constants";
import { LimitLoginByIpService } from "./rate-limiter.service";

/**
 * The shared Redis connection is created with `enableOfflineQueue: false`, so
 * commands reject immediately while Redis is down. The limiter must catch that
 * rejection instead of letting it reach the global filter as a 500 on login,
 * TOTP and installation endpoints (round 27, P2-1).
 */
function brokenRedis(): RedisService {
  return {
    isConfigured: () => true,
    // Any command on this stub throws a TypeError, which is what a rejecting
    // ioredis command looks like to rate-limiter-flexible.
    getClient: () => ({}) as never,
  } as unknown as RedisService;
}

describe("rate limiter Redis degradation", () => {
  it("fails open when the Redis backend rejects a lookup", async () => {
    const limiter = new LimitLoginByIpService(brokenRedis());
    assert.equal(await limiter.isAllowed("203.0.113.9"), true);
  });

  it("swallows backend failures when incrementing or deleting a bucket", async () => {
    const limiter = new LimitLoginByIpService(brokenRedis());
    await limiter.increment("203.0.113.9");
    await limiter.delete("203.0.113.9");
  });

  it("keeps enforcing the quota on the in-memory fallback", async () => {
    const memoryOnly = { isConfigured: () => false } as unknown as RedisService;
    const limiter = new LimitLoginByIpService(memoryOnly);
    const points = SECURITY_RATE_LIMITER.ipLoginLimiter.points;

    for (let attempt = 0; attempt < points; attempt++) {
      assert.equal(await limiter.isAllowed("198.51.100.7"), true);
      await limiter.increment("198.51.100.7");
    }

    assert.equal(await limiter.isAllowed("198.51.100.7"), false);
  });
});
