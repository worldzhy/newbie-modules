import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { test } from "node:test";
import type { AlertScopeVisibilityPort } from "./alert-center.constants";
import { AlertCenterController } from "./alert-center.controller";
import type { AlertCenterService, RaiseAlertInput, ResolveAlertInput } from "./alert-center.service";

/**
 * Behavior tests for the HTTP write guard: a caller may only write alerts into
 * the scopes the host says it owns, so the write permission never becomes a
 * cross-tenant write capability (R5-P2-02).
 */

const USER = "user-1";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

const request = { user: { userId: USER } };

function createHarness(visibleScopeIds: string[] = [PROJECT_A]) {
  const raised: RaiseAlertInput[] = [];
  const resolved: ResolveAlertInput[] = [];
  const lookups: string[] = [];

  const service = {
    raise: async (input: RaiseAlertInput) => {
      raised.push(input);
      return { id: "alert-1", state: "firing" as const, isNew: true };
    },
    resolve: async (input: ResolveAlertInput) => {
      resolved.push(input);
      return { id: "alert-1" };
    },
  };
  const visibility: AlertScopeVisibilityPort = {
    visibleScopeIds: async (userId: string) => {
      lookups.push(userId);
      return visibleScopeIds;
    },
  };

  const controller = new AlertCenterController(service as unknown as AlertCenterService, visibility);
  return { controller, raised, resolved, lookups };
}

test("a write inside the caller's scopes reaches the alert center", async () => {
  const harness = createHarness();

  const result = await harness.controller.raise(request, {
    source: "url-check",
    alertKey: "site-1",
    scopeId: PROJECT_A,
    severity: "high",
  });

  assert.equal(result.id, "alert-1");
  assert.deepEqual(harness.lookups, [USER]);
  assert.equal(harness.raised.length, 1);
  assert.equal(harness.raised[0].scopeId, PROJECT_A);
});

test("a raise into a foreign scope is rejected before touching the alert center", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.controller.raise(request, {
      source: "url-check",
      alertKey: "site-1",
      scopeId: PROJECT_B,
      severity: "high",
    }),
    ForbiddenException,
  );

  assert.deepEqual(harness.raised, []);
});

test("a resolve into a foreign scope is rejected before touching the alert center", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.controller.resolve(request, { source: "url-check", alertKey: "site-1", scopeId: PROJECT_B }),
    ForbiddenException,
  );

  assert.deepEqual(harness.resolved, []);
});

test("a write without a scope is platform-scoped and skips the visibility lookup", async () => {
  const harness = createHarness();

  await harness.controller.raise(request, { source: "url-check", alertKey: "site-1", severity: "high" });

  assert.deepEqual(harness.lookups, []);
  assert.equal(harness.raised.length, 1);
  assert.equal(harness.raised[0].scopeId, undefined);
});
