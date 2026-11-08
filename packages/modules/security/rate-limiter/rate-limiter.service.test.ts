import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RedisService } from "@modules/redis/redis.service";
import { SECURITY_RATE_LIMITER } from "../security-config.constants";
import { LimitLoginByIpService, RateLimiter, RateLimiterStore } from "./rate-limiter.service";

/**
 * The shared Redis connection is created with `enableOfflineQueue: false`, so
 * commands reject immediately while Redis is down. A rejection must neither
 * reach the global filter as a 500 on login/TOTP/installation endpoints nor
 * disable the quota for the duration of the outage (round 27, N-1/N-2).
 */
function brokenRedis(): RedisService {
  return {
    isConfigured: () => true,
    // Any command on this stub throws a TypeError, which is what a rejecting
    // ioredis command looks like to rate-limiter-flexible.
    getClient: () => ({}) as never,
  } as unknown as RedisService;
}

/** Redis stand-in whose availability can be flipped mid-test. */
function flakyStore(points: number) {
  let remaining = points;
  let exists = false;
  const calls = { get: 0, consume: 0, delete: 0 };
  const state = { failing: true };
  const store: RateLimiterStore = {
    async get() {
      calls.get += 1;
      if (state.failing) throw new Error("redis down");
      return exists ? { remainingPoints: remaining } : null;
    },
    async consume() {
      calls.consume += 1;
      if (state.failing) throw new Error("redis down");
      exists = true;
      remaining -= 1;
      return { remainingPoints: remaining };
    },
    async delete() {
      calls.delete += 1;
      if (state.failing) throw new Error("redis down");
      exists = false;
      remaining = points;
    },
  };
  return { store, calls, state };
}

describe("rate limiter Redis degradation", () => {
  it("falls back to the local bucket when Redis rejects a lookup", async () => {
    const limiter = new LimitLoginByIpService(brokenRedis());
    assert.equal(await limiter.isAllowed("203.0.113.9"), true);
  });

  it("keeps recording locally when Redis rejects an increment or delete", async () => {
    const limiter = new LimitLoginByIpService(brokenRedis());
    await limiter.increment("203.0.113.9");
    await limiter.delete("203.0.113.9");
  });

  it("keeps enforcing the quota on a Redis outage", async () => {
    const { store } = flakyStore(2);
    const limiter = new RateLimiter({ keyPrefix: "test-", points: 2, duration: 60 }, store, "test", 0);

    assert.equal(await limiter.isAllowed("k"), true);
    assert.equal(await limiter.spend("k"), 1);
    assert.equal(await limiter.spend("k"), 0);
    // The outage must not open the gate: the local bucket still blocks.
    assert.equal(await limiter.isAllowed("k"), false);
  });

  it("switches back to Redis once a probe succeeds", async () => {
    const { store, calls, state } = flakyStore(5);
    const limiter = new RateLimiter({ keyPrefix: "test-", points: 5, duration: 60 }, store, "test", 0);

    assert.equal(await limiter.isAllowed("k"), true);
    const probesWhileDown = calls.get;

    state.failing = false;
    assert.equal(await limiter.isAllowed("k"), true);
    assert.equal(calls.get, probesWhileDown + 1, "the limiter must probe Redis again");

    // Redis is authoritative again: five spends exhaust the shared bucket.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.spend("k");
    }
    assert.equal(await limiter.isAllowed("k"), false);
  });

  it("enforces the quota in memory when Redis was never configured", async () => {
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
