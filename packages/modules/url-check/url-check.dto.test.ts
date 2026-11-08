import assert from "node:assert/strict";
import { test } from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateUrlCheckTargetDto, UpdateUrlCheckTargetDto, UrlCheckTargetStatsRequestDto } from "./url-check.dto";

/**
 * Boundary tests for the request DTOs. The URL regex is the first line of the
 * "stored URL is rendered as an anchor" contract: a javascript: value must
 * never reach Postgres even if a caller bypasses the UI.
 */

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

async function violations<T extends object>(instance: T): Promise<Array<{ property: string; value: string }>> {
  const errors = await validate(instance);
  return errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map((value) => ({ property: error.property, value })),
  );
}

function createTarget(payload: Record<string, unknown>): CreateUrlCheckTargetDto {
  return plainToInstance(CreateUrlCheckTargetDto, payload);
}

test("create rejects non-http(s) and whitespace-bearing URLs", async () => {
  for (const url of ["javascript:alert(1)", "ftp://example.com/file", "https://example.com/a b", ""]) {
    const found = await violations(createTarget({ projectId: PROJECT_ID, name: "Target", url }));
    assert.ok(found.length >= 1, url);
    assert.ok(
      found.every((entry) => entry.property === "url"),
      url,
    );
  }
});

test("create accepts an uppercase http(s) scheme", async () => {
  const found = await violations(
    createTarget({ projectId: PROJECT_ID, name: "Target", url: "HTTPS://EXAMPLE.COM/health" }),
  );
  assert.deepEqual(found, []);
});

test("create enforces the uuid, name and url length bounds", async () => {
  const found = await violations(
    createTarget({ projectId: "not-a-uuid", name: "a".repeat(256), url: `https://example.com/${"a".repeat(2048)}` }),
  );
  assert.deepEqual(found.map((entry) => entry.property).sort(), ["name", "projectId", "url"]);

  const withinBounds = await violations(
    createTarget({
      projectId: PROJECT_ID,
      name: "a".repeat(255),
      url: `https://example.com/${"a".repeat(2027)}`,
    }),
  );
  assert.deepEqual(withinBounds, []);
});

test("update accepts an empty body and rejects malformed optional fields", async () => {
  assert.deepEqual(await violations(plainToInstance(UpdateUrlCheckTargetDto, {})), []);

  const found = await violations(
    plainToInstance(UpdateUrlCheckTargetDto, { url: "not a url", isActive: "yes", name: "" }),
  );
  assert.deepEqual(found.map((entry) => entry.property).sort(), ["isActive", "name", "url"]);
});

test("stats window only accepts the documented values", async () => {
  for (const window of ["24h", "7d", "30d"]) {
    assert.deepEqual(await violations(plainToInstance(UrlCheckTargetStatsRequestDto, { window })), [], window);
  }
  assert.deepEqual(await violations(plainToInstance(UrlCheckTargetStatsRequestDto, {})), []);
  const found = await violations(plainToInstance(UrlCheckTargetStatsRequestDto, { window: "1y" }));
  assert.equal(found.length, 1);
  assert.equal(found[0].property, "window");
});
