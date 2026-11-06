import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * ADR-051 wiring contract: every threshold signal funnels through the Redis
 * state machine (shouldFire on breach, resolveIfClean on clean window) so a
 * persistent alert does not re-notify every minute and a recovered one emits a
 * single resolved notification.
 *
 * The state logic itself is hard to unit-test without booting Nest + Redis +
 * ClickHouse, so this test pins the wiring counts in jobs.service.ts. A future
 * behavioral change (e.g. skipping resolved for one more signal) must update
 * these expectations deliberately.
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "jobs.service.ts"), "utf8");

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

test("every signal checks the cooldown before firing", () => {
  // slow-page, slow-first-paint, slow-resource, slow-ajax, js-error-spike,
  // js-error-first-seen — six signals, one shouldFire() guard each.
  assert.equal(occurrences(SERVICE_SOURCE, "await this.shouldFire("), 6);
});

test("every level signal resolves after clean windows; first-seen does not", () => {
  // five level-style signals (slow-* x4 + js-error-spike) resolve; the
  // first-seen edge detector has no resolved notification.
  assert.equal(occurrences(SERVICE_SOURCE, "await this.resolveIfClean("), 5);
});

test("firing and resolved phases are emitted with the right counts", () => {
  assert.equal(occurrences(SERVICE_SOURCE, 'phase: "firing"'), 6);
  assert.equal(occurrences(SERVICE_SOURCE, 'phase: "resolved"'), 5);
});

test("cooldown and recovery constants are declared", () => {
  assert.ok(SERVICE_SOURCE.includes("ALERT_COOLDOWN_MS"));
  assert.ok(SERVICE_SOURCE.includes("ALERT_RESOLVED_WINDOWS"));
  assert.ok(SERVICE_SOURCE.includes("alert-state:"));
});

function methodBody(source: string, signature: string, nextSignature: string): string {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature);
  assert.ok(start !== -1 && end > start, `${signature} must exist before ${nextSignature}`);
  return source.slice(start, end);
}

test("shouldFire fails open on Redis failure; resolveIfClean fails closed", () => {
  // ADR-051: a Redis outage must never silence alerts, and must never claim
  // "resolved" while the firing state cannot be confirmed.
  const shouldFire = methodBody(SERVICE_SOURCE, "private async shouldFire(", "private async resolveIfClean(");
  assert.ok(shouldFire.includes("catch"), "shouldFire must guard Redis commands with try/catch");
  assert.ok(shouldFire.includes("firing without cooldown"), "shouldFire must log its fail-open path");

  const resolveIfClean = methodBody(
    SERVICE_SOURCE,
    "private async resolveIfClean(",
    "private buildClickHouseTimeFilter(",
  );
  assert.ok(resolveIfClean.includes("catch"), "resolveIfClean must guard Redis commands with try/catch");
  assert.ok(resolveIfClean.includes("skipping recovery check"), "resolveIfClean must log its fail-closed path");
});

test("evaluation proceeds without the Redis lock when Redis fails", () => {
  const entry = methodBody(SERVICE_SOURCE, "async evaluateThresholdAlerts()", "private async evaluateSystem(");
  assert.ok(entry.includes("this.redis.isConfigured()"), "the lock must be skipped when Redis is not configured");
  assert.ok(entry.includes("proceeding without it"), "lock failure must degrade to lock-free evaluation");
});
