import assert from "node:assert/strict";
import { test } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { WebMonitorClickHouseService } from "./web-monitor-clickhouse.service";

/**
 * The service wires the shared ClickHouse client into the web table factories
 * (ADR-015: one host-level shared database; collectors own no topology of
 * their own). This suite pins the config key, the create-database-first
 * ordering, per-appKey table name derivation, model caching and the appKey
 * guard, all against a fake client.
 */

interface CreateModelCall {
  tableName: string;
  dbName: string;
}

function newService(options: { database?: string } = {}) {
  const database = options.database ?? "nightwatch";
  const events: string[] = [];
  const models: CreateModelCall[] = [];
  const configKeys: string[] = [];
  const configService = {
    getOrThrow(key: string) {
      configKeys.push(key);
      return database;
    },
  };
  const clickhouse = {
    async createDatabase(dbName: string) {
      events.push(`createDatabase:${dbName}`);
    },
    async createModel(schema: { tableName: string }, dbName: string) {
      models.push({ tableName: schema.tableName, dbName });
      events.push(`createModel:${schema.tableName}`);
      return { tableName: schema.tableName };
    },
  };
  const service = new WebMonitorClickHouseService(configService as never, clickhouse as never);
  return { service, events, models, configKeys };
}

async function newInitializedService(options: { database?: string } = {}) {
  const context = newService(options);
  await context.service.onModuleInit();
  return context;
}

test("onModuleInit reads the shared database name from the clickhouse config", async () => {
  const { configKeys } = await newInitializedService();
  assert.deepEqual(configKeys, ["modules.clickhouse.database"]);
});

test("onModuleInit ensures the database before any table factory runs", async () => {
  const { service, events } = newService();
  assert.deepEqual(events, [], "no ClickHouse call may happen before onModuleInit");
  await service.onModuleInit();
  assert.deepEqual(events, ["createDatabase:nightwatch"], "the database is ensured before any table creation");
});

test("WebAjax and WebError derive the table name from the appKey", async () => {
  const { service, models } = await newInitializedService();
  await service.WebAjax("abc1234");
  await service.WebError("abc1234");
  assert.deepEqual(
    models.map((call) => call.tableName),
    ["web_monitor_requests_abc1234", "web_monitor_errors_abc1234"],
  );
  assert.ok(
    models.every((call) => call.dbName === "nightwatch"),
    "every table is created in the shared host database",
  );
});

test("different appKeys partition into different tables", async () => {
  const { service, models } = await newInitializedService();
  await service.WebAjax("abc1234");
  await service.WebAjax("def5678");
  assert.deepEqual(
    models.map((call) => call.tableName),
    ["web_monitor_requests_abc1234", "web_monitor_requests_def5678"],
  );
});

test("WebSdkError uses one static table without an appKey suffix", async () => {
  const { service, models } = await newInitializedService();
  const first = await service.WebSdkError();
  const second = await service.WebSdkError();
  assert.equal(first, second);
  assert.deepEqual(
    models.map((call) => call.tableName),
    ["web_monitor_sdk_errors"],
  );
});

test("repeated lookups for one appKey create the model only once", async () => {
  const { service, models } = await newInitializedService();
  const first = await service.WebAjax("abc1234");
  const second = await service.WebAjax("abc1234");
  assert.equal(first, second);
  assert.equal(models.length, 1, "the resolved model is cached per appKey");
});

test("concurrent lookups for one appKey share a single creation", async () => {
  const { service, models } = await newInitializedService();
  const [first, second] = await Promise.all([service.WebAjax("abc1234"), service.WebAjax("abc1234")]);
  assert.equal(first, second);
  assert.equal(models.length, 1, "an in-flight creation is reused, not duplicated");
});

test("an invalid appKey is rejected before any table creation", async () => {
  const { service, models } = await newInitializedService();
  await assert.rejects(service.WebAjax("bad-key"), BadRequestException);
  await assert.rejects(service.WebError(""), BadRequestException);
  assert.equal(models.length, 0, "no DDL may happen for an invalid appKey");
});
