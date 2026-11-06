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
