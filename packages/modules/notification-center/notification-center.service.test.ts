import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { NotificationCenterService } from "./notification-center.service";

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
  return new NotificationCenterService(prisma as never, registry as never);
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

function newServiceWithCenter(
  severity: string,
  floor: string,
  opts: { recoveryOf?: string; firingSeverity?: string } = {},
) {
  const created: Record<string, unknown>[] = [];
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
      findUnique: async () => ({ id: 1, isPushEnabled: true, minimumSeverity: floor }),
      create: async () => ({ id: 1, isPushEnabled: true, minimumSeverity: floor }),
    },
    notificationRecord: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `record-${created.length}` };
      },
    },
  };
  const registry = {
    get: (key: string) => {
      if (opts.recoveryOf && key === opts.recoveryOf) {
        return { titleTemplate: "title", detailTemplate: null, defaultSeverity: opts.firingSeverity ?? severity };
      }
      return {
        titleTemplate: "title",
        detailTemplate: null,
        defaultSeverity: severity,
        ...(opts.recoveryOf ? { recoveryOf: opts.recoveryOf } : {}),
      };
    },
  };
  const pushPort = {
    pushSystemText: async () => {
      pushed = true;
      return [];
    },
  };
  const service = new NotificationCenterService(prisma as never, registry as never, pushPort as never);
  return { service, created, pushed: () => pushed };
}

test("a delivery below the center floor is recorded in-app but not pushed", async () => {
  const { service, created, pushed } = newServiceWithCenter("medium", "high");
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.pushSuppressed, true);
  assert.equal(result.deduplicated, false);
  assert.equal(created.length, 1);
  assert.equal(pushed(), false);
});

test("a delivery at or above the center floor is recorded and pushed", async () => {
  const { service, created, pushed } = newServiceWithCenter("high", "high");
  const result = await service.notify({ notificationKey: "k" });
  assert.equal(result.pushSuppressed, false);
  assert.equal(created.length, 1);
  assert.equal(pushed(), true);
});

test("a recovered delivery on a shared key keeps the firing floor verdict", async () => {
  // The recovery record inherits the key's alert level (ADR-061), so a medium
  // alert that stays in-app keeps its recovery in-app too.
  const { service, created, pushed } = newServiceWithCenter("medium", "high");
  const result = await service.notify({ notificationKey: "k", status: "recovered" });
  assert.equal(result.pushSuppressed, true);
  assert.equal(created.length, 1);
  assert.equal(pushed(), false);
});

test("a dedicated recovered declaration is judged at its firing key's severity", async () => {
  // The recovery itself is declared "low", but recoveryOf points at a critical
  // firing alert, so the pair is pushed together (ADR-061).
  const { service, created, pushed } = newServiceWithCenter("low", "high", {
    recoveryOf: "k.firing",
    firingSeverity: "critical",
  });
  const result = await service.notify({ notificationKey: "k.recovered", status: "recovered" });
  assert.equal(result.pushSuppressed, false);
  assert.equal(created.length, 1);
  assert.equal(created[0].status, "recovered");
  assert.equal(pushed(), true);
});
