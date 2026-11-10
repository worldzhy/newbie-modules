import assert from "node:assert/strict";
import { test } from "node:test";

import { func } from "../../../shared/utils";
import { FrontendPvuvipTaskService } from "./pvuvip-task.service";

/**
 * Orchestration contracts for FrontendPvuvipTaskService: the minute task surveys
 * the trailing cron-derived window and stores type-1 rows stamped at the
 * window end; the day task surveys yesterday (history shape) and stores
 * type-2 rows stamped at the day start; one failing site must not stop the
 * others.
 */

function buildService(
  opts: {
    systems?: { appKey?: string }[];
    surveyErrorFor?: string;
  } = {},
) {
  const surveys: { appKey: string; beginTime: Date; endTime: Date; history?: boolean }[] = [];
  const saves: { appKey: string; time: Date; type: number; data: unknown }[] = [];
  const site = { getWebSiteList: async () => opts.systems ?? [] };
  const pvuvip = {
    getPvUvIpSurvey: async (appKey: string, beginTime: Date, endTime: Date, history?: boolean) => {
      surveys.push({ appKey, beginTime, endTime, history });
      if (opts.surveyErrorFor === appKey) throw new Error("boom");
      return { pv: 1 };
    },
    savePvUvIpData: async (appKey: string, time: Date, type: number, data: unknown) => {
      saves.push({ appKey, time, type, data });
      return {};
    },
  };
  const service = new FrontendPvuvipTaskService(site as never, pvuvip as never);
  (service as unknown as { logger: unknown }).logger = { error: () => {} };
  return { service, surveys, saves };
}

test("the minute task does nothing without web sites", async () => {
  const { service, surveys, saves } = buildService({ systems: [] });
  await service.getWebPvUvIpByMinute();
  assert.equal(surveys.length, 0);
  assert.equal(saves.length, 0);
});

test("the minute task surveys the trailing cron window and stores a type-1 row per site", async () => {
  const { service, surveys, saves } = buildService({ systems: [{ appKey: "a" }, {}, { appKey: "b" }] });
  await service.getWebPvUvIpByMinute();
  assert.deepEqual(surveys.map((s) => s.appKey).sort(), ["a", "b"], "sites without an appKey are skipped");
  const survey = surveys[0];
  assert.equal(
    survey.endTime.getTime() - survey.beginTime.getTime(),
    120_000,
    "the window follows the */2 minute cron",
  );
  assert.equal(survey.history, undefined, "the minute survey uses the realtime shape");
  assert.equal(saves.length, 2);
  assert.equal(saves[0].type, 1, "minute rows are stored as type 1");
  assert.equal(saves[0].time.getTime(), survey.endTime.getTime(), "the row is stamped at the window end");
});

test("a failing site is logged and does not stop the others", async () => {
  const { service, surveys, saves } = buildService({
    systems: [{ appKey: "a" }, { appKey: "b" }],
    surveyErrorFor: "a",
  });
  await service.getWebPvUvIpByMinute();
  assert.equal(surveys.length, 2);
  assert.deepEqual(
    saves.map((s) => s.appKey),
    ["b"],
  );
});

test("the day task does nothing without web sites", async () => {
  const { service, surveys } = buildService({ systems: [] });
  await service.getWebPvUvIpByDay();
  assert.equal(surveys.length, 0);
});

test("the day task surveys yesterday with the history shape and stores a type-2 row at the day start", async () => {
  const { service, surveys, saves } = buildService({ systems: [{ appKey: "a" }] });
  await service.getWebPvUvIpByDay();
  const expectedEnd = new Date(func.format(new Date(), "yyyy/MM/dd 00:00:00"));
  const survey = surveys[0];
  assert.equal(survey.endTime.getTime(), expectedEnd.getTime(), "the day window ends at today's local midnight");
  assert.equal(survey.beginTime.getTime(), expectedEnd.getTime() - 86_400_000);
  assert.equal(survey.history, true, "a daily aggregate needs the history survey shape");
  assert.equal(saves[0].type, 2, "daily rows are stored as type 2");
  assert.equal(saves[0].time.getTime(), survey.beginTime.getTime(), "the row is stamped at the day start");
});
