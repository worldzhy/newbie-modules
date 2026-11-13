import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationDeliveryRuleService } from "./notification-delivery-rule.service";
import { matchesDeliveryCondition, validateDeliveryCondition } from "./notification-center.constants";

function newService(state: { settingQueried: boolean }) {
  const prisma = {
    notificationSetting: {
      findUnique: async () => {
        state.settingQueried = true;
        return null;
      },
    },
  };
  const registry = {
    get: () => ({
      titleTemplate: "title",
      detailTemplate: null,
      defaultSeverity: "high",
    }),
  };
  const deliveryRules = { evaluate: async () => ({ action: "deliver", ruleId: "r1", reason: "rule" }) };
  const silences = { findActiveId: async () => null };
  return new NotificationCenterService(prisma as never, registry as never, deliveryRules as never, silences as never);
}

test("notify rejects a project outside the resolved scope before reading settings", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(
    service.notify({ notificationKey: "k", projectId: "p2", visibleProjectIds: ["p1"] }),
    ForbiddenException,
  );
  assert.equal(state.settingQueried, false);
});

test("notify proceeds for a project inside the resolved scope", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  // Reaching the setting lookup means the visibility gate passed; the stub
  // returns null so delivery stops with NotFound instead of writing a record.
  await assert.rejects(
    service.notify({ notificationKey: "k", projectId: "p2", visibleProjectIds: ["p1", "p2"] }),
    NotFoundException,
  );
  assert.equal(state.settingQueried, true);
});

test("notify stays platform-wide when no scope is supplied by the caller", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(service.notify({ notificationKey: "k", projectId: "p9" }), NotFoundException);
  assert.equal(state.settingQueried, true);
});

test("an empty resolved scope rejects every project instead of widening to all", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(
    service.notify({ notificationKey: "k", projectId: "p1", visibleProjectIds: [] }),
    ForbiddenException,
  );
  assert.equal(state.settingQueried, false);
});

type RuleSeed = { priority: number; condition: unknown; action: string; isEnabled?: boolean };

function newServiceWithCenter(severity: string, rules: RuleSeed[] = [], activeSilenceId: string | null = null) {
  const created: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  const alerts = new Map<string, Record<string, any>>();
  const silences = { findActiveId: async () => activeSilenceId };
  const ruleRows = rules.map((rule, index) => ({
    id: `rule-${index + 1}`,
    updatedAt: new Date(0),
    isEnabled: true,
    ...rule,
  }));
  let pushed = false;
  const prisma = {
    notificationSetting: {
      findUnique: async () => ({
        key: "k",
        scope: "system",
        isPushEnabled: true,
        defaultSeverity: severity,
      }),
    },
    notificationCenterSetting: {
      findUnique: async () => ({ id: 1, isPushEnabled: true }),
      create: async () => ({ id: 1, isPushEnabled: true }),
    },
    notificationDeliveryRule: {
      findMany: async ({ where }: any = {}) => {
        const rows = ruleRows.filter((rule) => (where?.isEnabled ? rule.isEnabled : true));
        return [...rows].sort((a, b) => a.priority - b.priority);
      },
    },
    notificationAlert: {
      // The alert table is keyed by fingerprint alone (ADR-064).
      findUnique: async ({ where }: any) => alerts.get(where.fingerprint) ?? null,
      create: async ({ data }: any) => {
        const row = {
          id: `alert-${alerts.size + 1}`,
          verdictAction: null,
          verdictRuleId: null,
          verdictReason: null,
          ...data,
        };
        alerts.set(data.fingerprint, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = [...alerts.values()].find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    notificationDeliveryAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        attempts.push(data);
        return data;
      },
    },
    notificationRecord: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `record-${created.length}` };
      },
    },
  };
  const registry = {
    get: () => ({
      titleTemplate: "title",
      detailTemplate: null,
      defaultSeverity: severity,
    }),
  };
  const pushPort = {
    pushSystemText: async () => {
      pushed = true;
      return [];
    },
  };
  const ruleService = new NotificationDeliveryRuleService(prisma as never, silences as never);
  const service = new NotificationCenterService(
    prisma as never,
    registry as never,
    ruleService as never,
    silences as never,
    pushPort as never,
  );
  return { service, ruleService, created, attempts, alerts, pushed: () => pushed };
}

const HIGH_RULE: RuleSeed[] = [{ priority: 10, condition: { severityAtLeast: "high" }, action: "deliver" }];

test("an active silence keeps a deliverable notification in-app", async () => {
  const { service, created, attempts, pushed } = newServiceWithCenter("critical", HIGH_RULE, "silence-1");
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.decision, "deliver");
  assert.equal(result.runtimeReason, "silenced");
  // The record still lands in the bell; only the push is intercepted.
  assert.equal(created.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].runtimeReason, "silenced");
  assert.equal(attempts[0].silenceId, "silence-1");
  assert.equal(pushed(), false);
});

test("an event matching a rule is recorded and pushed", async () => {
  const { service, created, attempts, pushed } = newServiceWithCenter("critical", HIGH_RULE);
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.decision, "deliver");
  assert.equal(result.reason, "rule");
  assert.equal(result.deduplicated, false);
  assert.equal(created.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].decision, "deliver");
  assert.equal(attempts[0].reason, "rule");
  assert.equal(pushed(), true);
});

test("an event no rule matches is recorded in-app but not pushed", async () => {
  const { service, created, attempts, pushed } = newServiceWithCenter("medium", HIGH_RULE);
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.decision, "suppress");
  assert.equal(result.reason, "no-rule-matched");
  assert.equal(created.length, 1);
  assert.equal(attempts[0].reason, "no-rule-matched");
  assert.equal(pushed(), false);
});

test("the first matching rule wins in priority order", async () => {
  const { service } = newServiceWithCenter("critical", [
    { priority: 20, condition: { notificationKeys: ["k"] }, action: "deliver" },
    { priority: 10, condition: { notificationKeys: ["k"] }, action: "suppress" },
  ]);
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.decision, "suppress");
  assert.equal(result.reason, "rule");
});

test("a disabled rule is skipped", async () => {
  const { service } = newServiceWithCenter("critical", [
    { priority: 10, condition: { severityAtLeast: "info" }, action: "suppress", isEnabled: false },
  ]);
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.decision, "suppress");
  assert.equal(result.reason, "no-rule-matched");
});

test("each recorded delivery writes one audit attempt on the same alert", async () => {
  const { service, created, attempts } = newServiceWithCenter("critical", HIGH_RULE);
  await service.notify({ notificationKey: "k" });
  await service.notify({ notificationKey: "k", status: "recovered" });
  assert.equal(created.length, 2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].alertId, attempts[0].alertId);
  assert.equal(attempts[1].reason, "rule");
});

test("a recovery reuses the verdict frozen on its alert", async () => {
  const { service, pushed } = newServiceWithCenter("medium", HIGH_RULE);
  assert.equal((await service.notify({ notificationKey: "k" })).decision, "suppress");
  // The recovered event is judged by the frozen verdict, not by its own labels.
  const recovery = await service.notify({ notificationKey: "k", status: "recovered" });
  assert.equal(recovery.decision, "suppress");
  assert.equal(pushed(), false);
});

test("alerts without a deduplication key are still split per project (R39-03)", async () => {
  const { service, attempts } = newServiceWithCenter("critical", HIGH_RULE);
  await service.notify({ notificationKey: "k", projectId: "p1" });
  await service.notify({ notificationKey: "k", projectId: "p2" });
  assert.equal(attempts.length, 2);
  // One project's frozen verdict must never decide another project's event.
  assert.notEqual(attempts[0].alertId, attempts[1].alertId);
});

test("the same project and deduplication key keep one alert lifecycle (R39-03)", async () => {
  const { service, attempts } = newServiceWithCenter("critical", HIGH_RULE);
  await service.notify({ notificationKey: "k", projectId: "p1", deduplicationKey: "task:1" });
  await service.notify({ notificationKey: "k", projectId: "p1", deduplicationKey: "task:1" });
  assert.equal(attempts[0].alertId, attempts[1].alertId);

  await service.notify({ notificationKey: "k", projectId: "p2", deduplicationKey: "task:1" });
  assert.notEqual(attempts[0].alertId, attempts[2].alertId);
});

test("the fingerprint, not the notification key, pairs the alert lifecycle (ADR-064)", async () => {
  const { service, alerts } = newServiceWithCenter("critical", HIGH_RULE);
  // Two different notification kinds that share one deduplication key describe
  // the same incident, so they must land on one alert row.
  await service.notify({ notificationKey: "url-check", projectId: "p1", deduplicationKey: "task:1" });
  await service.notify({ notificationKey: "heartbeat", projectId: "p1", deduplicationKey: "task:1" });
  assert.equal(alerts.size, 1);
});

test("an explicit alertKey pairs events whose notification and deduplication keys both differ (ADR-064)", async () => {
  const { service, alerts } = newServiceWithCenter("critical", HIGH_RULE);
  // The url-check shape: down and recovered carry different keys, so only
  // alertKey can tie them to one lifecycle.
  await service.notify({
    notificationKey: "url-check.down",
    projectId: "p1",
    deduplicationKey: "url-check:t1:100",
    alertKey: "url-check:t1:100",
  });
  await service.notify({
    notificationKey: "url-check.recovered",
    projectId: "p1",
    deduplicationKey: "url-check:t1:recovered:100",
    alertKey: "url-check:t1:100",
  });
  assert.equal(alerts.size, 1);
});

test("matchesDeliveryCondition treats absent fields as unfiltered and empty collections as never matching", () => {
  const labels = { phase: "firing" as const, severity: "high", notificationKey: "k", projectId: "p1" };
  assert.equal(matchesDeliveryCondition(undefined, labels), true);
  assert.equal(matchesDeliveryCondition({}, labels), true);
  assert.equal(matchesDeliveryCondition({ severityAtLeast: "critical" }, labels), false);
  assert.equal(matchesDeliveryCondition({ severityAtLeast: "medium" }, labels), true);
  assert.equal(matchesDeliveryCondition({ phase: "recovered" }, labels), false);
  assert.equal(matchesDeliveryCondition({ notificationKeys: [] }, labels), false);
  assert.equal(matchesDeliveryCondition({ notificationKeys: ["k"] }, labels), true);
  assert.equal(matchesDeliveryCondition({ notificationKeys: ["other"] }, labels), false);
  assert.equal(matchesDeliveryCondition({ projectIds: [] }, labels), false);
  assert.equal(matchesDeliveryCondition({ projectIds: ["p1"] }, labels), true);
  assert.equal(matchesDeliveryCondition({ projectIds: ["p2"] }, labels), false);
  // A rule scoped to projects can never match an event without a project.
  assert.equal(
    matchesDeliveryCondition({ projectIds: ["p1"] }, { phase: "firing", severity: "high", notificationKey: "k" }),
    false,
  );
});

test("validateDeliveryCondition keeps malformed rules out of the JSON column", () => {
  assert.deepEqual(validateDeliveryCondition({ severityAtLeast: "high" }), []);
  assert.deepEqual(validateDeliveryCondition(null), ["condition must be an object"]);
  assert.equal(validateDeliveryCondition({ severityAtLeast: "urgent" }).length, 1);
  assert.equal(validateDeliveryCondition({ phase: "resolved" }).length, 1);
  assert.equal(validateDeliveryCondition({ notificationKeys: [""] }).length, 1);
  assert.equal(validateDeliveryCondition({ unknownField: 1 }).length, 1);
  assert.equal(validateDeliveryCondition({ tags: { env: 1 } }).length, 1);
});

function newRuleStore(initial: Array<{ condition: unknown; action: string; isEnabled?: boolean }>) {
  let seq = initial.length;
  const rows = initial.map((rule, index) => ({
    id: `r${index + 1}`,
    priority: (index + 1) * 10,
    updatedAt: new Date(0),
    isEnabled: true,
    ...rule,
  }));
  const prisma = {
    notificationDeliveryRule: {
      count: async () => rows.length,
      findMany: async ({ orderBy }: any = {}) =>
        [...rows].sort((a, b) => (orderBy?.priority === "desc" ? b.priority - a.priority : a.priority - b.priority)),
      findFirst: async ({ orderBy }: any = {}) =>
        [...rows].sort((a, b) =>
          orderBy?.priority === "desc" ? b.priority - a.priority : a.priority - b.priority,
        )[0] ?? null,
      findUnique: async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `r${++seq}`, updatedAt: new Date(), ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const index = rows.findIndex((row) => row.id === where.id);
        return rows.splice(index, 1)[0];
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return {
    service: new NotificationDeliveryRuleService(prisma as never, { findActiveId: async () => null } as never),
    rows,
  };
}

test("create appends the new rule after the last priority", async () => {
  const { service, rows } = newRuleStore([{ condition: { severityAtLeast: "high" }, action: "deliver" }]);
  const created = await service.create({ condition: { notificationKeys: ["k"] }, action: "suppress" });
  assert.equal(created.priority, 20);
  assert.equal(rows.length, 2);
});

test("create rejects a condition the matcher cannot understand", async () => {
  const { service } = newRuleStore([{ condition: { severityAtLeast: "high" }, action: "deliver" }]);
  await assert.rejects(
    service.create({ condition: { severityAtLeast: "urgent" }, action: "deliver" }),
    BadRequestException,
  );
});

test("the last remaining rule cannot be deleted", async () => {
  const { service } = newRuleStore([{ condition: { severityAtLeast: "high" }, action: "deliver" }]);
  await assert.rejects(service.remove("r1"), BadRequestException);
});

test("reorder rewrites priorities from the submitted order", async () => {
  const { service } = newRuleStore([
    { condition: {}, action: "deliver" },
    { condition: {}, action: "deliver" },
    { condition: {}, action: "deliver" },
  ]);
  const reordered = await service.reorder(["r3", "r1", "r2"]);
  assert.deepEqual(
    reordered.map((rule) => rule.id),
    ["r3", "r1", "r2"],
  );
  assert.deepEqual(
    reordered.map((rule) => rule.priority),
    [10, 20, 30],
  );
});

test("reorder rejects an incomplete id list", async () => {
  const { service } = newRuleStore([
    { condition: {}, action: "deliver" },
    { condition: {}, action: "deliver" },
  ]);
  await assert.rejects(service.reorder(["r1"]), BadRequestException);
});

test("simulate reports the index of the deciding rule", async () => {
  const { service } = newRuleStore([
    { condition: { notificationKeys: ["other"] }, action: "deliver" },
    { condition: { severityAtLeast: "high" }, action: "deliver" },
  ]);
  const result = await service.simulate({ notificationKey: "k", severity: "critical" }, []);
  assert.equal(result.decision, "deliver");
  assert.equal(result.matchedRuleIndex, 2);
  assert.equal(result.matchedRuleId, "r2");
  assert.equal(result.ruleCount, 2);

  const unmatched = await service.simulate({ notificationKey: "k", severity: "low" }, []);
  assert.equal(unmatched.decision, "suppress");
  assert.equal(unmatched.reason, "no-rule-matched");
  assert.equal(unmatched.matchedRuleIndex, null);
});

test("simulate requires either a record or a key with severity", async () => {
  const { service } = newRuleStore([{ condition: {}, action: "deliver" }]);
  await assert.rejects(service.simulate({ notificationKey: "k" }, []), BadRequestException);
});
