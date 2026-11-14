import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationDeliveryRuleService } from "./notification-delivery-rule.service";
import { NotificationSettingService } from "./notification-setting.service";
import { matchesDeliveryCondition, validateDeliveryCondition } from "./notification-center.constants";

const TEST_CONFIG = {
  getOrThrow: (key: string) => (key === "modules.notification-center.retentionDays" ? "90" : undefined),
};

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
      kind: "event",
      titleTemplate: "title",
      detailTemplate: null,
    }),
  };
  const deliveryRules = { evaluate: async () => ({ action: "deliver", ruleId: "r1", reason: "rule" }) };
  return new NotificationCenterService(
    prisma as never,
    registry as never,
    deliveryRules as never,
    TEST_CONFIG as never,
  );
}

test("notify rejects a project outside the resolved scope before reading settings", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(
    service.notify({ notificationKey: "k", severity: "high", projectId: "p2", visibleProjectIds: ["p1"] }),
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
    service.notify({ notificationKey: "k", severity: "high", projectId: "p2", visibleProjectIds: ["p1", "p2"] }),
    NotFoundException,
  );
  assert.equal(state.settingQueried, true);
});

test("notify stays platform-wide when no scope is supplied by the caller", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(service.notify({ notificationKey: "k", severity: "high", projectId: "p9" }), NotFoundException);
  assert.equal(state.settingQueried, true);
});

test("an empty resolved scope rejects every project instead of widening to all", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(
    service.notify({ notificationKey: "k", severity: "high", projectId: "p1", visibleProjectIds: [] }),
    ForbiddenException,
  );
  assert.equal(state.settingQueried, false);
});

test("notify rejects a missing severity before reading settings", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(service.notify({ notificationKey: "k", severity: undefined as never }), BadRequestException);
  assert.equal(state.settingQueried, false);
});

test("notify rejects a severity outside the vocabulary", async () => {
  const state = { settingQueried: false };
  const service = newService(state);
  await assert.rejects(service.notify({ notificationKey: "k", severity: "urgent" as never }), BadRequestException);
  assert.equal(state.settingQueried, false);
});

type RuleSeed = { priority: number; condition: unknown; action: string; isEnabled?: boolean };

function newServiceWithCenter(severity: string, rules: RuleSeed[] = [], kind: "alert" | "event" = "event") {
  void severity;
  const created: Record<string, unknown>[] = [];
  const attempts: Record<string, unknown>[] = [];
  let evaluateInput: Record<string, unknown> | null = null;
  const ruleRows = rules.map((rule, index) => ({
    id: `rule-${index + 1}`,
    updatedAt: new Date(0),
    isEnabled: true,
    ...rule,
  }));
  let pushed = false;
  let prunes = 0;
  const prisma = {
    notificationSetting: {
      findUnique: async () => ({ key: "k", scope: "system", isPushEnabled: true }),
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
    notificationDeliveryAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        attempts.push(data);
        return data;
      },
      deleteMany: async () => {
        prunes += 1;
        return { count: 1 };
      },
    },
    notificationRecord: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `record-${created.length}` };
      },
      deleteMany: async () => ({ count: 2 }),
    },
  };
  const registry = {
    get: () => ({
      kind,
      titleTemplate: "firing title",
      detailTemplate: null,
      recoveredTitleTemplate: "recovered title",
      recoveredDetailTemplate: null,
    }),
  };
  const pushPort = {
    pushSystemText: async () => {
      pushed = true;
      return [];
    },
  };
  const ruleService = new NotificationDeliveryRuleService(prisma as never);
  const evaluate = ruleService.evaluate.bind(ruleService);
  ruleService.evaluate = (async (labels: Record<string, unknown>) => {
    evaluateInput = labels;
    return evaluate(labels as never);
  }) as never;
  const service = new NotificationCenterService(
    prisma as never,
    registry as never,
    ruleService as never,
    TEST_CONFIG as never,
    pushPort as never,
  );
  return {
    service,
    ruleService,
    created,
    attempts,
    pushed: () => pushed,
    prunes: () => prunes,
    evaluated: () => evaluateInput,
  };
}

const HIGH_RULE: RuleSeed[] = [{ priority: 10, condition: { severityAtLeast: "high" }, action: "deliver" }];

test("an event matching a rule is recorded and pushed", async () => {
  const { service, created, attempts, pushed, evaluated } = newServiceWithCenter("critical", HIGH_RULE);
  const result = await service.notify({ notificationKey: "k", severity: "critical" });
  assert.equal(result.decision, "deliver");
  assert.equal(result.reason, "rule");
  assert.equal(result.deduplicated, false);
  assert.equal(created.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].decision, "deliver");
  assert.equal(attempts[0].reason, "rule");
  assert.equal(attempts[0].alertId, undefined);
  assert.equal(pushed(), true);
  assert.deepEqual(evaluated(), { state: "firing", severity: "critical", notificationKey: "k", projectId: undefined });
});

test("an event no rule matches is recorded in-app but not pushed", async () => {
  const { service, created, attempts, pushed } = newServiceWithCenter("medium", HIGH_RULE);
  const result = await service.notify({ notificationKey: "k", severity: "medium" });
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
  const result = await service.notify({ notificationKey: "k", severity: "critical" });
  assert.equal(result.decision, "suppress");
  assert.equal(result.reason, "rule");
});

test("a disabled rule is skipped", async () => {
  const { service } = newServiceWithCenter("critical", [
    { priority: 10, condition: { severityAtLeast: "info" }, action: "suppress", isEnabled: false },
  ]);
  const result = await service.notify({ notificationKey: "k", severity: "critical" });
  assert.equal(result.decision, "suppress");
  assert.equal(result.reason, "no-rule-matched");
});

test("each recorded delivery writes one audit attempt, per delivery", async () => {
  const { service, created, attempts } = newServiceWithCenter("critical", HIGH_RULE, "alert");
  await service.notify({ notificationKey: "k", severity: "critical", state: "firing" });
  await service.notify({ notificationKey: "k", severity: "critical", state: "resolved" });
  assert.equal(created.length, 2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].reason, "rule");
});

test("the retention prune runs on the notify path at most once per hour", async () => {
  const { service, created, prunes } = newServiceWithCenter("critical", HIGH_RULE);
  await service.notify({ notificationKey: "k", severity: "critical" });
  await service.notify({ notificationKey: "k", severity: "critical" });
  // Both records are written; the expired-row scan is throttled in-process so a
  // busy producer cannot turn every delivery into a history sweep.
  assert.equal(created.length, 2);
  assert.equal(prunes(), 1);
});

test("rules are evaluated per delivery, so a resolved state can match its own rule", async () => {
  const { service, pushed } = newServiceWithCenter(
    "medium",
    [
      { priority: 10, condition: { severityAtLeast: "high" }, action: "deliver" },
      { priority: 20, condition: { state: "resolved" }, action: "deliver" },
    ],
    "alert",
  );
  assert.equal(
    (await service.notify({ notificationKey: "k", severity: "medium", state: "firing" })).decision,
    "suppress",
  );
  const recovery = await service.notify({ notificationKey: "k", severity: "medium", state: "resolved" });
  assert.equal(recovery.decision, "deliver");
  assert.equal(pushed(), true);
});

test("an alert-kind delivery with resolved state uses the recovered template and records the state", async () => {
  const { service, created, attempts } = newServiceWithCenter("critical", HIGH_RULE, "alert");
  await service.notify({
    notificationKey: "k",
    severity: "critical",
    state: "resolved",
    sourceType: "alert",
    sourceRef: "a1",
  });
  assert.equal(created[0].title, "recovered title");
  assert.equal(created[0].status, "resolved");
  assert.ok(created[0].recoveredAt instanceof Date);
  assert.equal(created[0].sourceType, "alert");
  assert.equal(created[0].sourceRef, "a1");
  assert.equal(attempts.length, 1);
});

test("an event-kind delivery ignores a state it was given", async () => {
  const { service, created } = newServiceWithCenter("critical", HIGH_RULE, "event");
  await service.notify({ notificationKey: "k", severity: "critical", state: "resolved" });
  assert.equal(created[0].title, "firing title");
  assert.equal(created[0].status, "firing");
  assert.equal(created[0].recoveredAt, null);
});

test("matchesDeliveryCondition treats absent fields as unfiltered and empty collections as never matching", () => {
  const labels = { state: "firing" as const, severity: "high", notificationKey: "k", projectId: "p1" };
  assert.equal(matchesDeliveryCondition(undefined, labels), true);
  assert.equal(matchesDeliveryCondition({}, labels), true);
  assert.equal(matchesDeliveryCondition({ severityAtLeast: "critical" }, labels), false);
  assert.equal(matchesDeliveryCondition({ severityAtLeast: "medium" }, labels), true);
  assert.equal(matchesDeliveryCondition({ state: "resolved" }, labels), false);
  assert.equal(matchesDeliveryCondition({ state: "firing" }, labels), true);
  assert.equal(matchesDeliveryCondition({ notificationKeys: [] }, labels), false);
  assert.equal(matchesDeliveryCondition({ notificationKeys: ["k"] }, labels), true);
  assert.equal(matchesDeliveryCondition({ notificationKeys: ["other"] }, labels), false);
  assert.equal(matchesDeliveryCondition({ projectIds: [] }, labels), false);
  assert.equal(matchesDeliveryCondition({ projectIds: ["p1"] }, labels), true);
  assert.equal(matchesDeliveryCondition({ projectIds: ["p2"] }, labels), false);
  // A rule scoped to projects can never match an event without a project.
  assert.equal(
    matchesDeliveryCondition({ projectIds: ["p1"] }, { state: "firing", severity: "high", notificationKey: "k" }),
    false,
  );
});

test("validateDeliveryCondition keeps malformed rules out of the JSON column", () => {
  assert.deepEqual(validateDeliveryCondition({ severityAtLeast: "high" }), []);
  assert.deepEqual(validateDeliveryCondition({ state: "resolved" }), []);
  assert.deepEqual(validateDeliveryCondition(null), ["condition must be an object"]);
  assert.equal(validateDeliveryCondition({ severityAtLeast: "urgent" }).length, 1);
  assert.equal(validateDeliveryCondition({ state: "recovered" }).length, 1);
  assert.equal(validateDeliveryCondition({ phase: "firing" }).length, 1);
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
    service: new NotificationDeliveryRuleService(prisma as never),
    rows,
  };
}

test("create appends the new rule after the last priority", async () => {
  const { service, rows } = newRuleStore([{ condition: { severityAtLeast: "high" }, action: "deliver" }]);
  const created = await service.create({ condition: { notificationKeys: ["k"] }, action: "suppress" });
  assert.equal(created.priority, 20);
  assert.equal(rows.length, 2);
});

test("create retries after a priority collision instead of failing the request", async () => {
  let attempts = 0;
  const prisma = {
    notificationDeliveryRule: {
      findFirst: async () => ({ priority: attempts === 0 ? 10 : 20 }),
      create: async ({ data }: any) => {
        attempts += 1;
        if (attempts === 1) {
          // The unique index settles the race; the retry re-reads the maximum.
          throw { code: "P2002" };
        }
        return { id: "r-new", updatedAt: new Date(0), ...data };
      },
    },
  };
  const service = new NotificationDeliveryRuleService(prisma as never);

  const created = await service.create({ condition: { severityAtLeast: "high" }, action: "deliver" });

  assert.equal(attempts, 2);
  assert.equal(created.priority, 30);
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

test("markAllRead pages through unread records instead of materialising them all", async () => {
  const total = 1_201;
  const unread = new Set(Array.from({ length: total }, (_, index) => `n-${index}`));
  let scans = 0;
  const prisma = {
    user: { findUnique: async () => ({ createdAt: new Date(0) }) },
    notificationRecord: {
      findMany: async ({ take }: any) => {
        scans += 1;
        return [...unread].slice(0, take).map((id) => ({ id }));
      },
    },
    notificationReceipt: {
      createMany: async ({ data }: any) => {
        for (const row of data) {
          unread.delete(row.notificationId);
        }
        return { count: data.length };
      },
    },
  };
  const service = new NotificationCenterService(prisma as never, {} as never, {} as never, TEST_CONFIG as never);

  const result = await service.markAllRead("u1", ["p1"]);

  assert.equal(result.marked, total);
  // 500 + 500 + 201: the short page ends the loop.
  assert.equal(scans, 3);
  assert.equal(unread.size, 0);
});

test("reconcileDeclarations realigns declared fields but leaves the operator toggle alone", async () => {
  const calls: any[] = [];
  const prisma = {
    notificationSetting: {
      upsert: async (args: any) => {
        calls.push(args);
        return args.create;
      },
    },
  };
  const registry = {
    getAll: () => [
      {
        key: "k",
        name: "Renamed",
        titleTemplate: "new title",
        detailTemplate: "new detail",
        scope: "system",
        defaultPushEnabled: false,
      },
    ],
  };
  const service = new NotificationSettingService(prisma as never, registry as never);

  await service.reconcileDeclarations();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].create.isPushEnabled, false);
  assert.equal(calls[0].update.titleTemplate, "new title");
  // The operator-owned flag is only written on create, never on update.
  assert.equal("isPushEnabled" in calls[0].update, false);
});
