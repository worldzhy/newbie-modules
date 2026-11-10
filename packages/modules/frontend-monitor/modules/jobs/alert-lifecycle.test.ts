import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * ADR-051 wiring contract: every threshold signal funnels through the Redis
 * state machine (shouldFire on breach, recoverIfClean on clean window) so a
 * persistent alert does not re-notify every minute and a recovered one emits a
 * single recovered notification.
 *
 * The state machine's fail-open / fail-closed behavior is covered by
 * alert-state.test.ts; this file only pins how jobs.service.ts wires it.
 */
const SERVICE_SOURCE = readFileSync(join(__dirname, "jobs.service.ts"), "utf8");

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

test("every signal checks the cooldown before firing", () => {
  // slow-page, slow-first-paint, slow-resource, slow-ajax, js-error-spike,
  // js-error-first-seen — six signals, one shouldFire() guard each.
  assert.equal(occurrences(SERVICE_SOURCE, "await this.alertState.shouldFire("), 6);
});

test("every level signal recovers after clean windows; first-seen does not", () => {
  // five level-style signals (slow-* x4 + js-error-spike) recover; the
  // first-seen edge detector has no recovered notification.
  assert.equal(occurrences(SERVICE_SOURCE, "await this.alertState.recoverIfClean("), 5);
});

test("firing and recovered phases are emitted with the right counts", () => {
  assert.equal(occurrences(SERVICE_SOURCE, 'phase: "firing"'), 6);
  assert.equal(occurrences(SERVICE_SOURCE, 'phase: "recovered"'), 5);
});

test("the state machine owns the cooldown and recovery constants", () => {
  const stateSource = readFileSync(join(__dirname, "alert-state.ts"), "utf8");
  assert.ok(stateSource.includes("ALERT_COOLDOWN_MS"));
  assert.ok(stateSource.includes("ALERT_RECOVERY_WINDOWS"));
  assert.ok(SERVICE_SOURCE.includes("new AlertStateMachine(this.redis, this.logger)"));
});

function methodBody(source: string, signature: string, nextSignature: string): string {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature);
  assert.ok(start !== -1 && end > start, `${signature} must exist before ${nextSignature}`);
  return source.slice(start, end);
}

test("evaluation proceeds without the Redis lock when Redis fails", () => {
  const entry = methodBody(SERVICE_SOURCE, "async evaluateThresholdAlerts()", "private async evaluateSystem(");
  assert.ok(entry.includes("this.redis.isConfigured()"), "the lock must be skipped when Redis is not configured");
  assert.ok(entry.includes("proceeding without it"), "lock failure must degrade to lock-free evaluation");
});
