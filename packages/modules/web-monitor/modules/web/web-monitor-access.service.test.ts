import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { WebMonitorAccessService } from "./web-monitor-access.service";

function newService(
  installation: { appKey?: string | null; revokedAt?: Date | null } | null,
  queried?: { value: boolean },
) {
  const prisma = {
    webMonitorInstallation: {
      findFirst: async () => {
        if (queried) queried.value = true;
        return installation;
      },
    },
  };
  return new WebMonitorAccessService(prisma as never);
}

test("rejects a project outside the resolved scope before querying installations", async () => {
  const queried = { value: false };
  const service = newService({ appKey: "abc1234", revokedAt: null }, queried);
  await assert.rejects(service.resolveAppKey(["p1"], "p2", "app-1"), ForbiddenException);
  assert.equal(queried.value, false);
});

test("rejects every project when the resolved scope is empty", async () => {
  const service = newService({ appKey: "abc1234", revokedAt: null });
  await assert.rejects(service.resolveAppKey([], "p1", "app-1"), ForbiddenException);
});

test("returns the installation appKey for a project inside the resolved scope", async () => {
  const service = newService({ appKey: "abc1234", revokedAt: null });
  assert.equal(await service.resolveAppKey(["p1"], "p1", "app-1"), "abc1234");
});

test("rejects a revoked installation", async () => {
  const service = newService({ appKey: "abc1234", revokedAt: new Date() });
  await assert.rejects(service.resolveAppKey(["p1"], "p1", "app-1"), ForbiddenException);
});
