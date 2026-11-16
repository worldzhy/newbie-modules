import assert from "node:assert/strict";
import test from "node:test";
import { AlertSourceRegistryService } from "./alert-source-registry.service";

function declaration(overrides: Partial<Parameters<AlertSourceRegistryService["register"]>[0]> = {}) {
  return { key: "url-check", displayName: "URL Check", ...overrides };
}

test("a duplicated source key is rejected", () => {
  const registry = new AlertSourceRegistryService();
  registry.register(declaration());
  assert.throws(() => registry.register(declaration()), /already registered: url-check/);
});

test("a default rhythm that is not a positive integer is rejected", () => {
  const registry = new AlertSourceRegistryService();
  assert.throws(() => registry.register(declaration({ defaultRepeatMinutes: 0 })), /Invalid defaultRepeatMinutes/);
  assert.throws(() => registry.register(declaration({ defaultRepeatMinutes: 1.5 })), /Invalid defaultRepeatMinutes/);
});

test("an omitted default rhythm falls back to 24 hours", () => {
  const registry = new AlertSourceRegistryService();
  registry.register(declaration());
  assert.equal(registry.require("url-check").defaultRepeatMinutes, 1440);
});

test("a pinned definition rhythm that is not a positive integer is rejected", () => {
  const registry = new AlertSourceRegistryService();
  assert.throws(
    () => registry.register(declaration({ definitions: [{ key: "down", displayName: "Down", repeatMinutes: 0 }] })),
    /Invalid repeatMinutes for url-check\/down/,
  );
});

test("a duplicated definition key is rejected", () => {
  const registry = new AlertSourceRegistryService();
  assert.throws(
    () =>
      registry.register(
        declaration({
          definitions: [
            { key: "down", displayName: "Endpoint down" },
            { key: "down", displayName: "Endpoint down again" },
          ],
        }),
      ),
    /Duplicate alert definition key in source: url-check/,
  );
});

test("definitions are optional and an unpinned rhythm normalizes to null", () => {
  const registry = new AlertSourceRegistryService();
  registry.register(declaration());
  registry.register(
    declaration({
      key: "heartbeat",
      displayName: "Heartbeat",
      definitions: [{ key: "offline", displayName: "Installation offline" }],
    }),
  );
  assert.deepEqual(registry.require("url-check").definitions, []);
  assert.deepEqual(registry.require("heartbeat").definitions, [
    { key: "offline", displayName: "Installation offline", repeatMinutes: null },
  ]);
});
