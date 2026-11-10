import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALERT_COOLDOWN_MS,
  ALERT_RECOVERY_WINDOWS,
  ALERT_STATE_TTL_SECONDS,
  AlertState,
  AlertStateMachine,
  AlertStateRedis,
  AlertStateRedisClient,
} from "./alert-state";

/**
 * R20-09: the previous fail-open / fail-closed coverage was a text assertion
 * over jobs.service.ts. These tests drive the extracted state machine with a
 * fake Redis so the branches are exercised, not matched by substring.
 */

interface FakeOptions {
  isConfigured?: boolean;
  initial?: Record<string, string>;
  getError?: Error;
  writeError?: Error;
}

function fakeRedis(options: FakeOptions = {}) {
  const store = new Map<string, string>(Object.entries(options.initial ?? {}));
  const calls: Array<{ method: string; key: string; value?: string; args?: unknown[] }> = [];
  const client: AlertStateRedisClient = {
    async get(key) {
      calls.push({ method: "get", key });
      if (options.getError) throw options.getError;
      return store.get(key) ?? null;
    },
    async set(key, value, expirationMode, ttlSeconds) {
      calls.push({ method: "set", key, value, args: [expirationMode, ttlSeconds] });
      if (options.writeError) throw options.writeError;
      store.set(key, value);
      return "OK";
    },
    async del(key) {
      calls.push({ method: "del", key });
      if (options.writeError) throw options.writeError;
      store.delete(key);
      return 1;
    },
  };
  const redis: AlertStateRedis = {
    isConfigured: () => options.isConfigured ?? true,
    getClient: () => client,
  };
  const warnings: string[] = [];
  const machine = new AlertStateMachine(redis, { warn: (message) => warnings.push(message) });
  return { machine, store, calls, warnings };
}

function firingState(lastFiredAt: string, cleanWindows = 0): AlertState {
  return {
    status: "firing",
    firstFiredAt: lastFiredAt,
    lastFiredAt,
    cleanWindows,
  };
}

test("shouldFire fires immediately when Redis is not configured", async () => {
  const { machine, calls } = fakeRedis({ isConfigured: false });
  assert.equal(await machine.shouldFire("k"), true);
  assert.equal(calls.length, 0, "an unconfigured Redis must not be touched");
});

test("shouldFire records the first fire", async () => {
  const { machine, store, calls } = fakeRedis();
  assert.equal(await machine.shouldFire("k"), true);
  const stored = JSON.parse(store.get("k") ?? "{}") as AlertState;
  assert.equal(stored.status, "firing");
  assert.equal(stored.cleanWindows, 0);
  const write = calls.find((call) => call.method === "set");
  assert.deepEqual(write?.args, ["EX", ALERT_STATE_TTL_SECONDS]);
});

test("shouldFire suppresses a second breach inside the cooldown", async () => {
  const { machine, store } = fakeRedis({
    initial: { k: JSON.stringify(firingState(new Date().toISOString())) },
  });
  assert.equal(await machine.shouldFire("k"), false);
  const stored = JSON.parse(store.get("k") ?? "{}") as AlertState;
  assert.equal(stored.cleanWindows, 0, "a breach resets the clean counter");
});

test("shouldFire re-fires after the cooldown elapsed", async () => {
  const stale = new Date(Date.now() - ALERT_COOLDOWN_MS - 1_000).toISOString();
  const { machine } = fakeRedis({ initial: { k: JSON.stringify(firingState(stale)) } });
  assert.equal(await machine.shouldFire("k"), true);
});

test("shouldFire fails open when the Redis read throws", async () => {
  const { machine, warnings } = fakeRedis({ getError: new Error("connection refused") });
  assert.equal(await machine.shouldFire("k"), true, "an alerting system must not go silent on Redis failure");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /firing without cooldown/);
});

test("shouldFire fails open when the Redis write throws", async () => {
  const { machine } = fakeRedis({ writeError: new Error("connection refused") });
  assert.equal(await machine.shouldFire("k"), true);
});

test("recoverIfClean never recovers without Redis or without firing state", async () => {
  assert.equal(await fakeRedis({ isConfigured: false }).machine.recoverIfClean("k"), false);
  assert.equal(await fakeRedis().machine.recoverIfClean("k"), false);
});

test("recoverIfClean waits for the configured number of clean windows", async () => {
  const { machine, store, calls } = fakeRedis({
    initial: { k: JSON.stringify(firingState(new Date().toISOString())) },
  });
  for (let window = 1; window < ALERT_RECOVERY_WINDOWS; window += 1) {
    assert.equal(await machine.recoverIfClean("k"), false, `clean window ${window} must not recover yet`);
    const stored = JSON.parse(store.get("k") ?? "{}") as AlertState;
    assert.equal(stored.cleanWindows, window);
  }
  assert.equal(await machine.recoverIfClean("k"), true);
  assert.equal(store.has("k"), false, "recovery deletes the state key");
  assert.ok(calls.some((call) => call.method === "del"));
});

test("recoverIfClean fails closed when the Redis read throws", async () => {
  const { machine, warnings } = fakeRedis({ getError: new Error("connection refused") });
  assert.equal(await machine.recoverIfClean("k"), false, "never claim recovery while state cannot be confirmed");
  assert.match(warnings[0], /skipping recovery check/);
});

test("recoverIfClean fails closed when the Redis write throws", async () => {
  const { machine } = fakeRedis({ writeError: new Error("connection refused") });
  assert.equal(await machine.recoverIfClean("k"), false);
});
