import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { EventEmitter2 } from "@nestjs/event-emitter";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import { UrlCheckProbeService } from "./url-check-probe.service";

/**
 * Transport-level behavior tests for the url-check probe: redirect handling
 * (every hop re-runs the SSRF guard), the up/down status boundary, what lands
 * in the ClickHouse row, and the resilience rules around the insert and the
 * per-target loop. The state-machine thresholds are covered separately in
 * url-check-probe.test.ts; this file drives the same runChecks() entry point
 * with a scriptable fetch.
 */

// RFC 5737 documentation range: passes the SSRF guard without any DNS lookup.
const PROBE_URL = "http://198.51.100.10/health";

interface FakeTarget {
  id: string;
  projectId: string;
  name: string;
  url: string;
  isActive: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  isAlertOpen: boolean;
  alertOpenedAt: Date | null;
  lastCheckedAt: Date | null;
  lastStatusCode: number | null;
  lastIsUp: boolean | null;
}

interface InsertedRow {
  target_id: string;
  project_id: string;
  url: string;
  is_up: boolean;
  status_code: number | null;
  duration_ms: number;
  error: string;
  checked_at: string;
}

interface EmittedEvent {
  event: string;
  payload: Record<string, unknown>;
}

function makeTarget(index: number, overrides: Partial<FakeTarget> = {}): FakeTarget {
  return {
    id: `11111111-1111-4111-8111-1111111111${String(index).padStart(2, "0")}`,
    projectId: "22222222-2222-4222-8222-222222222222",
    name: `Target ${index}`,
    url: PROBE_URL,
    isActive: true,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isAlertOpen: false,
    alertOpenedAt: null,
    lastCheckedAt: null,
    lastStatusCode: null,
    lastIsUp: null,
    ...overrides,
  };
}

function createHarness(targets: FakeTarget[], options: { insertFails?: boolean; failUpdatesFor?: string[] } = {}) {
  const incidents: Array<Record<string, unknown>> = [];
  const inserted: InsertedRow[] = [];
  const emitted: EmittedEvent[] = [];

  const updateRow = async ({ where, data }: { where: { id: string }; data: Partial<FakeTarget> }) => {
    if (options.failUpdatesFor?.includes(where.id)) {
      throw new Error(`simulated write failure for ${where.id}`);
    }
    const row = targets.find((target) => target.id === where.id);
    assert.ok(row, `target ${where.id} must exist`);
    Object.assign(row, data);
    return { ...row };
  };

  const tx = {
    urlCheckTarget: { update: updateRow },
    urlCheckIncident: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        incidents.push({ ...data, recoveredAt: null, durationMs: null });
      },
      updateMany: async ({ where, data }: { where: { targetId: string }; data: Record<string, unknown> }) => {
        const touched = incidents.filter((incident) => incident.targetId === where.targetId);
        for (const incident of touched) Object.assign(incident, data);
        return { count: touched.length };
      },
    },
  };

  const prisma = {
    urlCheckTarget: {
      findMany: async ({ where }: { where: { isActive: boolean } }) =>
        targets.filter((target) => target.isActive === where.isActive).map((target) => ({ ...target })),
      update: updateRow,
    },
    urlCheckIncident: tx.urlCheckIncident,
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  };

  const clickhouse = {
    insert: async ({ values }: { values: InsertedRow[] }) => {
      if (options.insertFails) throw new Error("clickhouse unavailable");
      inserted.push(...values.map((value) => ({ ...value })));
    },
  };

  const emitter = {
    emit: (event: string, payload: Record<string, unknown>) => {
      emitted.push({ event, payload });
      return true;
    },
  };

  const service = new UrlCheckProbeService(
    prisma as unknown as PrismaService,
    clickhouse as unknown as ClickHouseService,
    emitter as unknown as EventEmitter2,
  );

  return {
    service,
    targets,
    inserted,
    emitted,
    incidents,
  };
}

let fetchCalls: string[] = [];

function stubFetch(handler: (url: string, callIndex: number) => Promise<Response> | Response): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const callIndex = fetchCalls.length;
    fetchCalls.push(url);
    return handler(url, callIndex);
  }) as typeof fetch;
}

afterEach(() => {
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

test("follows a relative redirect and records the original target URL", async () => {
  const harness = createHarness([makeTarget(0)]);
  stubFetch((_url, callIndex) => {
    if (callIndex === 0) return redirectTo("/healthz");
    return new Response(null, { status: 200 });
  });

  await harness.service.runChecks();

  assert.deepEqual(fetchCalls, [PROBE_URL, "http://198.51.100.10/healthz"]);
  assert.equal(harness.inserted.length, 1);
  const row = harness.inserted[0];
  assert.equal(row.url, PROBE_URL);
  assert.equal(row.is_up, true);
  assert.equal(row.status_code, 200);
  assert.equal(row.error, "");
  assert.match(row.checked_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(harness.targets[0].lastIsUp, true);
  assert.equal(harness.targets[0].consecutiveFailures, 0);
});

test("blocks a redirect that points at a private address before fetching it", async () => {
  const harness = createHarness([makeTarget(0)]);
  stubFetch((_url, callIndex) => {
    if (callIndex === 0) return redirectTo("http://127.0.0.1:8080/admin");
    return new Response(null, { status: 200 });
  });

  await harness.service.runChecks();

  assert.equal(fetchCalls.length, 1);
  const row = harness.inserted[0];
  assert.equal(row.is_up, false);
  assert.equal(row.status_code, null);
  assert.match(row.error, /not a public address/);
  assert.equal(harness.targets[0].consecutiveFailures, 1);
});

test("gives up after more than five redirect hops", async () => {
  const harness = createHarness([makeTarget(0)]);
  stubFetch(() => redirectTo("http://198.51.100.10/hop"));

  await harness.service.runChecks();

  assert.equal(fetchCalls.length, 6);
  const row = harness.inserted[0];
  assert.equal(row.is_up, false);
  assert.match(row.error, /Too many redirects \(>5\)/);
});

test("treats 399 as up and 400 as down", async () => {
  const upHarness = createHarness([makeTarget(0)]);
  stubFetch(() => new Response(null, { status: 399 }));
  await upHarness.service.runChecks();
  assert.equal(upHarness.inserted[0].is_up, true);
  assert.equal(upHarness.inserted[0].status_code, 399);

  const downHarness = createHarness([makeTarget(0)]);
  stubFetch(() => new Response(null, { status: 400 }));
  await downHarness.service.runChecks();
  assert.equal(downHarness.inserted[0].is_up, false);
  assert.equal(downHarness.inserted[0].status_code, 400);
  // HTTP-level failures carry no error detail; the status is the signal.
  assert.equal(downHarness.inserted[0].error, "");
});

test("records a network failure with a null status and the error message", async () => {
  const harness = createHarness([makeTarget(0)]);
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });

  await harness.service.runChecks();

  const row = harness.inserted[0];
  assert.equal(row.is_up, false);
  assert.equal(row.status_code, null);
  assert.equal(row.error, "fetch failed");
  assert.ok(row.duration_ms >= 0);
  assert.equal(harness.targets[0].lastStatusCode, null);
  assert.equal(harness.targets[0].lastIsUp, false);
});

test("never buffers the response body", async () => {
  const harness = createHarness([makeTarget(0)]);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("payload that must not be read"));
    },
    cancel() {
      cancelled = true;
    },
  });
  stubFetch(() => new Response(stream, { status: 200 }));

  await harness.service.runChecks();

  assert.equal(cancelled, true);
});

test("keeps the state machine advancing when the result insert fails", async () => {
  const harness = createHarness([makeTarget(0)], { insertFails: true });
  stubFetch(() => new Response(null, { status: 500 }));

  await harness.service.runChecks();

  assert.equal(harness.inserted.length, 0);
  assert.equal(harness.targets[0].consecutiveFailures, 1);
  assert.ok(harness.targets[0].lastCheckedAt instanceof Date);
  assert.equal(harness.targets[0].lastStatusCode, 500);
});

test("isolates a failing target from the rest of the cycle", async () => {
  const bad = makeTarget(0, { name: "Bad" });
  const good = makeTarget(1, { name: "Good" });
  const harness = createHarness([bad, good], { failUpdatesFor: [bad.id] });
  stubFetch(() => new Response(null, { status: 200 }));

  await harness.service.runChecks();

  assert.equal(harness.targets[0].lastIsUp, null);
  assert.equal(harness.targets[1].lastIsUp, true);
  assert.ok(harness.targets[1].lastCheckedAt instanceof Date);
});

test("probes at most ten targets concurrently", async () => {
  const targets = Array.from({ length: 11 }, (_value, index) => makeTarget(index));
  const harness = createHarness(targets);
  let inFlight = 0;
  let maxInFlight = 0;
  stubFetch(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return new Response(null, { status: 200 });
  });

  await harness.service.runChecks();

  assert.equal(maxInFlight, 10);
  assert.equal(fetchCalls.length, 11);
  assert.equal(harness.inserted.length, 11);
  for (const target of harness.targets) {
    assert.ok(target.lastCheckedAt instanceof Date, target.name);
  }
});

test("the down event carries the HTTP status as its detail", async () => {
  const harness = createHarness([makeTarget(0, { consecutiveFailures: 2 })]);
  stubFetch(() => new Response(null, { status: 500 }));

  await harness.service.runChecks();

  assert.equal(harness.emitted.length, 1);
  assert.equal(harness.emitted[0].event, "url-check.down");
  assert.equal(harness.emitted[0].payload.error, "HTTP 500");
  assert.equal(harness.emitted[0].payload.url, PROBE_URL);
  assert.equal(harness.emitted[0].payload.consecutiveFailures, 3);
  assert.equal(typeof harness.emitted[0].payload.downSince, "string");
});

test("the recovered event reports downtime from the alert-open timestamp", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness([
    makeTarget(0, { consecutiveFailures: 0, consecutiveSuccesses: 2, isAlertOpen: true, alertOpenedAt: openedAt }),
  ]);
  stubFetch(() => new Response(null, { status: 200 }));

  await harness.service.runChecks();

  assert.equal(harness.emitted.length, 1);
  assert.equal(harness.emitted[0].event, "url-check.recovered");
  const payload = harness.emitted[0].payload;
  assert.equal(payload.downSince, openedAt.toISOString());
  assert.equal(typeof payload.recoveredAt, "string");
  const downtimeMinutes = payload.downtimeMinutes;
  assert.ok(
    typeof downtimeMinutes === "number" && downtimeMinutes >= 9 && downtimeMinutes <= 11,
    String(downtimeMinutes),
  );
});
