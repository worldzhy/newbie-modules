import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { ClickhouseService } from "@modules/clickhouse/clickhouse.service";
import { UrlCheckProbeService } from "./url-check-probe.service";

/**
 * Behavior-level tests for the alert state machine (ADR-022/023/024), driven
 * through the public runChecks() cycle with a stubbed fetch and fake stores.
 * The contract under test is: when alerts open/close, what lands in Postgres
 * (target rolling columns + incident row in one transaction) and which domain
 * events are emitted on the bus. Implementation details are not asserted.
 */

const TARGET_ID = "11111111-1111-4111-8111-111111111111";

interface FakeTargetRow {
  id: string;
  projectId: string;
  name: string;
  url: string;
  isActive: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  isAlertOpen: boolean;
  alertOpenedAt: Date | null;
}

interface FakeIncidentRow {
  targetId: string;
  openedAt: Date;
  recoveredAt: Date | null;
  durationMs: number | null;
  peakConsecutiveFailures: number;
}

interface FakeEmittedEvent {
  event: string;
  payload: Record<string, unknown>;
}

// A public documentation-range address (RFC 5737): passes the SSRF guard
// without any DNS lookup; fetch is stubbed, so no traffic ever leaves.
const PROBE_URL = "http://198.51.100.10/health";

function stubFetch(outcome: "up" | "down") {
  globalThis.fetch = (async () => {
    if (outcome === "down") {
      throw new TypeError("fetch failed");
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  // Other test files run in separate processes; restore within this file.
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

function createHarness(targetOverrides: Partial<FakeTargetRow> = {}, seedIncidents: FakeIncidentRow[] = []) {
  const dbTarget: FakeTargetRow = {
    id: TARGET_ID,
    projectId: "22222222-2222-4222-8222-222222222222",
    name: "Example",
    url: PROBE_URL,
    isActive: true,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isAlertOpen: false,
    alertOpenedAt: null,
    ...targetOverrides,
  };
  const incidents: FakeIncidentRow[] = seedIncidents.map((incident) => ({ ...incident }));
  const emitted: FakeEmittedEvent[] = [];

  const tx = {
    urlMonitorTarget: {
      update: async ({ data }: { data: Partial<FakeTargetRow> }) => {
        Object.assign(dbTarget, data);
        return { ...dbTarget };
      },
    },
    urlMonitorIncident: {
      create: async ({ data }: { data: { targetId: string; openedAt: Date; peakConsecutiveFailures: number } }) => {
        incidents.push({ ...data, recoveredAt: null, durationMs: null });
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { targetId: string; recoveredAt: null; peakConsecutiveFailures?: { lt: number } };
        data: Partial<FakeIncidentRow>;
      }) => {
        for (const row of incidents) {
          if (row.targetId !== where.targetId || row.recoveredAt !== null) continue;
          if (where.peakConsecutiveFailures && !(row.peakConsecutiveFailures < where.peakConsecutiveFailures.lt))
            continue;
          Object.assign(row, data);
        }
      },
    },
  };

  const prisma = {
    urlMonitorTarget: {
      ...tx.urlMonitorTarget,
      // Each cycle reads a fresh snapshot, like a real database read.
      findMany: async () => [{ ...dbTarget }],
    },
    urlMonitorIncident: tx.urlMonitorIncident,
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  };
  const clickhouse = { insert: async () => undefined };
  const emitter = {
    emit: (event: string, payload: Record<string, unknown>) => {
      emitted.push({ event, payload });
      return true;
    },
  };

  const service = new UrlCheckProbeService(
    prisma as unknown as PrismaService,
    clickhouse as unknown as ClickhouseService,
    emitter as unknown as EventEmitter2,
  );

  return {
    service,
    incidents,
    emitted,
    readTarget: () => ({ ...dbTarget }),
  };
}

test("a failure below the threshold only increments the counter", async () => {
  const harness = createHarness({ consecutiveFailures: 0 });
  stubFetch("down");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().consecutiveFailures, 1);
  assert.equal(harness.readTarget().isAlertOpen, false);
  assert.equal(harness.incidents.length, 0);
  assert.equal(harness.emitted.length, 0);
});

test("the third consecutive failure opens an alert and its incident", async () => {
  const harness = createHarness({ consecutiveFailures: 2 });
  stubFetch("down");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.ok(harness.readTarget().alertOpenedAt instanceof Date);
  assert.equal(harness.incidents.length, 1);
  assert.equal(harness.incidents[0].peakConsecutiveFailures, 3);
  assert.equal(harness.incidents[0].recoveredAt, null);
  assert.deepEqual(
    harness.emitted.map((entry) => entry.event),
    ["url-check.down"],
  );
  // The event carries everything the host needs to route an alarm.
  const payload = harness.emitted[0].payload;
  assert.equal(payload.targetId, TARGET_ID);
  assert.equal(payload.url, PROBE_URL);
  assert.equal(payload.consecutiveFailures, 3);
  assert.equal(typeof payload.downSince, "string");
});

test("continued failures during an open alert only raise the incident peak", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness({ consecutiveFailures: 4, isAlertOpen: true, alertOpenedAt: openedAt }, [
    { targetId: TARGET_ID, openedAt, recoveredAt: null, durationMs: null, peakConsecutiveFailures: 4 },
  ]);
  stubFetch("down");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().consecutiveFailures, 5);
  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.incidents[0].peakConsecutiveFailures, 5);
  assert.equal(harness.incidents[0].recoveredAt, null);
  assert.equal(harness.emitted.length, 0);
});

test("successes below the recovery threshold keep the alert open", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness({ consecutiveFailures: 3, isAlertOpen: true, alertOpenedAt: openedAt }, [
    { targetId: TARGET_ID, openedAt, recoveredAt: null, durationMs: null, peakConsecutiveFailures: 3 },
  ]);
  stubFetch("up");

  await harness.service.runChecks();
  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.readTarget().consecutiveSuccesses, 1);
  assert.equal(harness.readTarget().consecutiveFailures, 0);
  assert.equal(harness.incidents[0].recoveredAt, null);

  await harness.service.runChecks();
  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.readTarget().consecutiveSuccesses, 2);
  assert.equal(harness.emitted.length, 0);
});

test("the third consecutive success closes the alert and the incident", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness(
    { consecutiveFailures: 0, consecutiveSuccesses: 2, isAlertOpen: true, alertOpenedAt: openedAt },
    [{ targetId: TARGET_ID, openedAt, recoveredAt: null, durationMs: null, peakConsecutiveFailures: 3 }],
  );
  stubFetch("up");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().isAlertOpen, false);
  assert.equal(harness.readTarget().alertOpenedAt, null);
  assert.equal(harness.readTarget().consecutiveSuccesses, 0);
  assert.ok(harness.incidents[0].recoveredAt instanceof Date);
  assert.ok(typeof harness.incidents[0].durationMs === "number" && harness.incidents[0].durationMs > 0);
  assert.deepEqual(
    harness.emitted.map((entry) => entry.event),
    ["url-check.recovered"],
  );
  const payload = harness.emitted[0].payload;
  assert.equal(payload.targetId, TARGET_ID);
  assert.equal(typeof payload.recoveredAt, "string");
  assert.equal(typeof payload.downtimeMinutes, "number");
});

test("a failure mid-recovery resets the success streak without events", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness(
    { consecutiveFailures: 0, consecutiveSuccesses: 1, isAlertOpen: true, alertOpenedAt: openedAt },
    [{ targetId: TARGET_ID, openedAt, recoveredAt: null, durationMs: null, peakConsecutiveFailures: 3 }],
  );
  stubFetch("down");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.readTarget().consecutiveSuccesses, 0);
  assert.equal(harness.readTarget().consecutiveFailures, 1);
  // A single failure after partial recovery stays below the incident peak.
  assert.equal(harness.incidents[0].peakConsecutiveFailures, 3);
  assert.equal(harness.incidents[0].recoveredAt, null);
  assert.equal(harness.emitted.length, 0);
});

test("a success without an open alert only resets the counters", async () => {
  const harness = createHarness({ consecutiveFailures: 1 });
  stubFetch("up");

  await harness.service.runChecks();

  assert.equal(harness.readTarget().consecutiveFailures, 0);
  assert.equal(harness.readTarget().consecutiveSuccesses, 0);
  assert.equal(harness.incidents.length, 0);
  assert.equal(harness.emitted.length, 0);
});

test("a flapping target produces exactly one alert pair for the whole storm", async () => {
  const harness = createHarness();

  // Three failures open the alert.
  stubFetch("down");
  await harness.service.runChecks();
  await harness.service.runChecks();
  await harness.service.runChecks();
  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.emitted.length, 1);

  // Flapping: single successes never reach the recovery threshold, failures
  // keep the (already open) alert without re-notifying.
  stubFetch("up");
  await harness.service.runChecks();
  stubFetch("down");
  await harness.service.runChecks();
  stubFetch("up");
  await harness.service.runChecks();
  stubFetch("down");
  await harness.service.runChecks();
  assert.equal(harness.readTarget().isAlertOpen, true);
  assert.equal(harness.emitted.length, 1);

  // Sustained success finally recovers.
  stubFetch("up");
  await harness.service.runChecks();
  await harness.service.runChecks();
  await harness.service.runChecks();
  assert.equal(harness.readTarget().isAlertOpen, false);

  assert.deepEqual(
    harness.emitted.map((entry) => entry.event),
    ["url-check.down", "url-check.recovered"],
  );
  assert.equal(harness.incidents.length, 1);
  assert.ok(harness.incidents[0].recoveredAt instanceof Date);
});
