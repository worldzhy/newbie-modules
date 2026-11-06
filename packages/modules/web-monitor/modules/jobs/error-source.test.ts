import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIRST_SEEN_SOURCE_FILTER,
  FIRST_SEEN_SOURCES,
  NON_ERROR_SOURCES,
  SPIKE_SOURCE_FILTER,
} from "./error-source.ts";

/**
 * ADR-050 contract: `api` is the single error-source column, "new error" alerts
 * only open for runtime crashes, and the volume signal ignores console noise
 * without dropping ajax/fetch/resource rows.
 *
 * The literal source names mirror `ERROR_APIS` in
 * `devbie/packages/web-monitor-sdk/src/common/utils.ts`; the SDK is a published
 * dependency, so the registry cannot import it and asserts the cross-repo
 * contract explicitly here.
 */
const SDK_RUNTIME_SOURCES = ["onerror", "unhandled-rejection"];
const SDK_CONSOLE_SOURCE = "console-error";
const SDK_RESOURCE_SOURCE = "resource-error";

const SERVICE_SOURCE = readFileSync(fileURLToPath(new URL("./jobs.service.ts", import.meta.url)), "utf8");

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

test("first-seen whitelist covers the SDK runtime sources only", () => {
  assert.deepEqual([...FIRST_SEEN_SOURCES], SDK_RUNTIME_SOURCES);
  assert.match(FIRST_SEEN_SOURCE_FILTER, /^api IN \(.+\)$/);
  for (const source of SDK_RUNTIME_SOURCES) {
    assert.ok(FIRST_SEEN_SOURCE_FILTER.includes(`'${source}'`), `missing ${source}`);
  }
  assert.ok(!FIRST_SEEN_SOURCE_FILTER.includes(SDK_CONSOLE_SOURCE));
  assert.ok(!FIRST_SEEN_SOURCE_FILTER.includes(SDK_RESOURCE_SOURCE));
});

test("spike blacklist drops console rows and keeps every other source", () => {
  assert.deepEqual([...NON_ERROR_SOURCES], [SDK_CONSOLE_SOURCE]);
  assert.match(SPIKE_SOURCE_FILTER, /^api NOT IN \(.+\)$/);
  assert.ok(SPIKE_SOURCE_FILTER.includes(`'${SDK_CONSOLE_SOURCE}'`));
  // Resource failures and ajax/fetch rows (empty api) must still count.
  assert.ok(!SPIKE_SOURCE_FILTER.includes(SDK_RESOURCE_SOURCE));
  for (const source of SDK_RUNTIME_SOURCES) {
    assert.ok(!SPIKE_SOURCE_FILTER.includes(`'${source}'`));
  }
});

test("both signals wire the shared predicates in both of their queries", () => {
  // Grouping + baseline for first-seen; count + top-items for the spike.
  assert.equal(occurrences(SERVICE_SOURCE, "AND ${FIRST_SEEN_SOURCE_FILTER}"), 2);
  assert.equal(occurrences(SERVICE_SOURCE, "AND ${SPIKE_SOURCE_FILTER}"), 2);
});

test("the service does not hand-write its own api predicate", () => {
  assert.ok(!SERVICE_SOURCE.includes("api IN ("));
  assert.ok(!SERVICE_SOURCE.includes("api NOT IN ("));
  assert.ok(!SERVICE_SOURCE.includes(`'${SDK_CONSOLE_SOURCE}'`));
});
