import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { UrlCheckService } from "./url-check.service";

/**
 * Behavior-level tests for the admin-side url-check store. The contract under
 * test is: what reaches Postgres (targets + incidents, including the pause
 * path that must close an open alert in the same transaction), what reaches
 * ClickHouse (query shape, target binding, limit bounds), and how the stats
 * window is mapped to ClickHouse bucket expressions. The SSRF guard is driven
 * through its real implementation; only the stores are faked.
 */

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const PUBLIC_URL = "https://example.com/health";

interface TargetRow {
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
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface IncidentRow {
  id: string;
  targetId: string;
  openedAt: Date;
  recoveredAt: Date | null;
  durationMs: number | null;
  peakConsecutiveFailures: number;
}

type SeedTarget = Pick<TargetRow, "id" | "projectId" | "name" | "url"> & Partial<TargetRow>;

function createHarness(seed: { projects?: string[]; targets?: SeedTarget[]; incidents?: IncidentRow[] } = {}) {
  const projects = new Set(seed.projects ?? [PROJECT_ID]);
  const targets: TargetRow[] = (seed.targets ?? []).map((target, index) => ({
    isActive: true,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isAlertOpen: false,
    alertOpenedAt: null,
    lastCheckedAt: null,
    lastStatusCode: null,
    lastIsUp: null,
    createdByUserId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1_000),
    updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 1_000),
    ...target,
  }));
  const incidents: IncidentRow[] = (seed.incidents ?? []).map((incident) => ({ ...incident }));
  const counters = {
    projectLookups: 0,
    targetCreates: 0,
    targetDeletes: 0,
    transactions: 0,
    writesOutsideTransaction: 0,
    incidentUpdateMany: 0,
  };
  let insideTransaction = false;
  const recordWrite = () => {
    if (!insideTransaction) counters.writesOutsideTransaction += 1;
  };

  const findTarget = (id: string) => targets.find((target) => target.id === id);

  const targetStore = {
    findMany: async ({ where }: { where: { projectId?: string } }) =>
      targets
        .filter((target) => (where.projectId ? target.projectId === where.projectId : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((target) => ({ ...target })),
    findUnique: async ({ where }: { where: { id: string } }) => {
      const found = findTarget(where.id);
      return found ? { ...found } : null;
    },
    create: async ({ data }: { data: Omit<TargetRow, "id" | "createdAt" | "updatedAt"> }) => {
      recordWrite();
      counters.targetCreates += 1;
      const row: TargetRow = {
        ...data,
        id: TARGET_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      targets.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<TargetRow> }) => {
      recordWrite();
      const row = findTarget(where.id);
      assert.ok(row, `target ${where.id} must exist before update`);
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      recordWrite();
      counters.targetDeletes += 1;
      const index = targets.findIndex((target) => target.id === where.id);
      return targets.splice(index, 1)[0];
    },
  };

  const aggregateCalls: Array<{ targetId: string; gte: Date }> = [];

  const incidentStore = {
    findMany: async ({ where, take }: { where: { targetId: string }; orderBy: { openedAt: "desc" }; take: number }) =>
      incidents
        .filter((incident) => incident.targetId === where.targetId)
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
        .slice(0, take)
        .map((incident) => ({ ...incident })),
    aggregate: async ({ where }: { where: { targetId: string; recoveredAt: { not: null; gte: Date } } }) => {
      aggregateCalls.push({ targetId: where.targetId, gte: where.recoveredAt.gte });
      const closed = incidents.filter(
        (incident) =>
          incident.targetId === where.targetId &&
          incident.recoveredAt !== null &&
          incident.recoveredAt.getTime() >= where.recoveredAt.gte.getTime(),
      );
      const durations = closed
        .map((incident) => incident.durationMs)
        .filter((duration): duration is number => typeof duration === "number");
      return {
        _count: closed.length,
        _avg: {
          durationMs: durations.length
            ? durations.reduce((total, duration) => total + duration, 0) / durations.length
            : null,
        },
      };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { targetId: string; recoveredAt: null };
      data: Partial<IncidentRow>;
    }) => {
      recordWrite();
      counters.incidentUpdateMany += 1;
      const touched = incidents.filter(
        (incident) => incident.targetId === where.targetId && incident.recoveredAt === null,
      );
      for (const incident of touched) Object.assign(incident, data);
      return { count: touched.length };
    },
  };

  const tx = { urlCheckTarget: targetStore, urlCheckIncident: incidentStore };

  const prisma = {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        counters.projectLookups += 1;
        return projects.has(where.id) ? { id: where.id } : null;
      },
    },
    urlCheckTarget: targetStore,
    urlCheckIncident: incidentStore,
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      counters.transactions += 1;
      insideTransaction = true;
      try {
        return await callback(tx);
      } finally {
        insideTransaction = false;
      }
    },
  };

  const queries: Array<{ query: string; query_params: Record<string, unknown> }> = [];
  const clickhouseResponses: unknown[][] = [];
  const clickhouse = {
    query: async (options: { query: string; query_params: Record<string, unknown> }) => {
      queries.push({ query: options.query, query_params: options.query_params });
      const rows = clickhouseResponses.shift() ?? [];
      return { json: async () => rows };
    },
  };

  const service = new UrlCheckService(prisma as unknown as PrismaService, clickhouse as unknown as ClickHouseService);

  return {
    service,
    targets,
    incidents,
    counters,
    queries,
    aggregateCalls,
    queueClickhouseRows: (...rows: unknown[][]) => clickhouseResponses.push(...rows),
  };
}

test("create rejects a non-public URL before touching the database", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.create(
      { projectId: PROJECT_ID, name: "Metadata", url: "http://169.254.169.254/latest/meta-data" },
      "user",
    ),
    /not a public address/,
  );

  // Fail-fast ordering: neither the project lookup nor the insert may run.
  assert.equal(harness.counters.projectLookups, 0);
  assert.equal(harness.counters.targetCreates, 0);
});

test("create rejects non-http schemes at the service boundary", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.create({ projectId: PROJECT_ID, name: "Script", url: "javascript:alert(1)" }, "user"),
    /Only http\(s\) URLs/,
  );
  await assert.rejects(
    harness.service.create({ projectId: PROJECT_ID, name: "Bad", url: "not a url" }, "user"),
    /Invalid URL/,
  );
  await assert.rejects(
    harness.service.create({ projectId: PROJECT_ID, name: "Loopback", url: "http://[::1]/" }, "user"),
    /not a public address/,
  );
  assert.equal(harness.counters.targetCreates, 0);
});

test("create rejects an unknown project without writing the target", async () => {
  const harness = createHarness({ projects: [] });

  await assert.rejects(
    harness.service.create({ projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }, "user"),
    (error: unknown) => error instanceof Error && error.name === "NotFoundException",
  );
  assert.equal(harness.counters.targetCreates, 0);
});

test("create persists the validated target with the creator id", async () => {
  const harness = createHarness();

  const created = await harness.service.create({ projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }, "user-1");

  assert.equal(created.projectId, PROJECT_ID);
  assert.equal(created.url, PUBLIC_URL);
  assert.equal(created.createdByUserId, "user-1");
  assert.equal(harness.targets.length, 1);
  assert.equal(harness.counters.writesOutsideTransaction, 1);
});

test("list returns only the requested project's targets, newest first", async () => {
  const harness = createHarness({
    targets: [
      {
        id: TARGET_ID,
        projectId: PROJECT_ID,
        name: "Older",
        url: PUBLIC_URL,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      },
      {
        id: "11111111-1111-4111-8111-111111111112",
        projectId: PROJECT_ID,
        name: "Newer",
        url: PUBLIC_URL,
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
      {
        id: "11111111-1111-4111-8111-111111111113",
        projectId: OTHER_PROJECT_ID,
        name: "Foreign",
        url: PUBLIC_URL,
        createdAt: new Date(Date.UTC(2026, 0, 3)),
      },
    ],
  });

  const rows = await harness.service.list(PROJECT_ID);

  assert.deepEqual(
    rows.map((row) => row.name),
    ["Newer", "Older"],
  );
});

test("update rejects re-pointing to a blocked address and leaves the row untouched", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
  });

  await assert.rejects(
    harness.service.update(TARGET_ID, { name: "Renamed", url: "http://127.0.0.1:8080/admin" }),
    /not a public address/,
  );

  const row = harness.targets[0];
  assert.equal(row.name, "Health");
  assert.equal(row.url, PUBLIC_URL);
  assert.equal(harness.counters.writesOutsideTransaction, 0);
});

test("update on a missing target throws NotFound", async () => {
  const harness = createHarness();

  await assert.rejects(harness.service.update(TARGET_ID, { name: "Renamed" }), (error: unknown) => {
    return error instanceof Error && error.name === "NotFoundException";
  });
});

test("pausing an alerting target closes the alert and its incident in one transaction", async () => {
  const openedAt = new Date(Date.now() - 600_000);
  const harness = createHarness({
    targets: [
      {
        id: TARGET_ID,
        projectId: PROJECT_ID,
        name: "Health",
        url: PUBLIC_URL,
        isAlertOpen: true,
        alertOpenedAt: openedAt,
        consecutiveFailures: 4,
      },
    ],
    incidents: [
      {
        id: "incident-1",
        targetId: TARGET_ID,
        openedAt,
        recoveredAt: null,
        durationMs: null,
        peakConsecutiveFailures: 5,
      },
    ],
  });

  const updated = await harness.service.update(TARGET_ID, { isActive: false });

  assert.equal(updated.isActive, false);
  assert.equal(updated.isAlertOpen, false);
  assert.equal(updated.alertOpenedAt, null);
  assert.equal(harness.incidents[0].recoveredAt instanceof Date, true);
  const durationMs = harness.incidents[0].durationMs;
  assert.ok(typeof durationMs === "number" && durationMs >= 600_000 && durationMs < 610_000, String(durationMs));
  assert.equal(harness.counters.transactions, 1);
  assert.equal(harness.counters.writesOutsideTransaction, 0);
});

test("pausing a healthy target performs no incident write", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
    incidents: [
      {
        id: "incident-1",
        targetId: TARGET_ID,
        openedAt: new Date(Date.now() - 3_600_000),
        recoveredAt: new Date(Date.now() - 1_800_000),
        durationMs: 1_800_000,
        peakConsecutiveFailures: 3,
      },
    ],
  });

  const updated = await harness.service.update(TARGET_ID, { isActive: false });

  assert.equal(updated.isActive, false);
  assert.equal(updated.isAlertOpen, false);
  assert.equal(harness.counters.incidentUpdateMany, 0);
});

test("delete rejects an unknown target and removes an existing one", async () => {
  const empty = createHarness();
  await assert.rejects(empty.service.delete(TARGET_ID), (error: unknown) => {
    return error instanceof Error && error.name === "NotFoundException";
  });
  assert.equal(empty.counters.targetDeletes, 0);

  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
  });
  assert.deepEqual(await harness.service.delete(TARGET_ID), { success: true });
  assert.equal(harness.targets.length, 0);
});

test("listCheckResults applies the default limit and clamps oversized/zero/negative values", async () => {
  const cases: Array<{ limit: string | undefined; expected: number }> = [
    { limit: undefined, expected: 50 },
    { limit: "300", expected: 200 },
    { limit: "0", expected: 50 },
    { limit: "-7", expected: 50 },
    { limit: "abc", expected: 50 },
    { limit: "12", expected: 12 },
  ];

  for (const { limit, expected } of cases) {
    const harness = createHarness({
      targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
    });
    harness.queueClickhouseRows([]);

    await harness.service.listCheckResults(TARGET_ID, limit);

    assert.equal(harness.queries.length, 1, `limit=${limit}`);
    assert.equal(harness.queries[0].query_params.limit, expected, `limit=${limit}`);
  }
});

test("listCheckResults binds the target id and returns the UTC timestamp as ISO-8601", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
  });
  // Exactly what ClickHouse JSONEachRow emits for DateTime64(3, 'UTC').
  harness.queueClickhouseRows([
    { isUp: true, statusCode: 200, durationMs: 12, error: "", checkedAt: "2026-11-08 11:52:00.080" },
  ]);

  const rows = await harness.service.listCheckResults(TARGET_ID);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].checkedAt, "2026-11-08T11:52:00.080Z");
  assert.equal(new Date(rows[0].checkedAt).toISOString(), "2026-11-08T11:52:00.080Z");
  const { query, query_params } = harness.queries[0];
  assert.match(query, /FROM url_check_results/);
  assert.match(query, /WHERE target_id = \{targetId: UUID\}/);
  assert.match(query, /ORDER BY checked_at DESC/);
  assert.equal(query_params.targetId, TARGET_ID);
});

test("listCheckResults refuses an unknown target without querying ClickHouse", async () => {
  const harness = createHarness();

  await assert.rejects(harness.service.listCheckResults(TARGET_ID), (error: unknown) => {
    return error instanceof Error && error.name === "NotFoundException";
  });
  assert.equal(harness.queries.length, 0);
});

test("listIncidents returns newest first and honours the limit", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
    incidents: [
      {
        id: "old",
        targetId: TARGET_ID,
        openedAt: new Date(Date.UTC(2026, 0, 1)),
        recoveredAt: new Date(Date.UTC(2026, 0, 1, 1)),
        durationMs: 3_600_000,
        peakConsecutiveFailures: 3,
      },
      {
        id: "new",
        targetId: TARGET_ID,
        openedAt: new Date(Date.UTC(2026, 0, 3)),
        recoveredAt: null,
        durationMs: null,
        peakConsecutiveFailures: 4,
      },
    ],
  });

  const rows = await harness.service.listIncidents(TARGET_ID, "2");
  assert.deepEqual(
    rows.map((row) => row.id),
    ["new", "old"],
  );

  const limited = await harness.service.listIncidents(TARGET_ID, "1");
  assert.deepEqual(
    limited.map((row) => row.id),
    ["new"],
  );
});

test("getStats reports nulls and the 24h default when no probe data exists", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
  });
  harness.queueClickhouseRows([], []);

  const stats = await harness.service.getStats(TARGET_ID);

  assert.equal(stats.window, "24h");
  assert.equal(stats.totalChecks, 0);
  assert.equal(stats.upChecks, 0);
  assert.equal(stats.availability, null);
  assert.equal(stats.mttrMs, null);
  assert.deepEqual(stats.latency, []);
  assert.match(harness.queries[0].query, /INTERVAL 24 HOUR/);
});

test("getStats computes the availability ratio and rounds the mean outage", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
    incidents: [
      {
        id: "incident-1",
        targetId: TARGET_ID,
        openedAt: new Date(Date.now() - 3_600_000),
        recoveredAt: new Date(Date.now() - 1_800_000),
        durationMs: 120,
        peakConsecutiveFailures: 3,
      },
      {
        id: "incident-2",
        targetId: TARGET_ID,
        openedAt: new Date(Date.now() - 7_200_000),
        recoveredAt: new Date(Date.now() - 3_600_000),
        durationMs: 128,
        peakConsecutiveFailures: 3,
      },
    ],
  });
  harness.queueClickhouseRows(
    [{ totalChecks: 100, upChecks: 97 }],
    [
      {
        bucketStart: 1,
        totalChecks: 100,
        upChecks: 97,
        avgDurationMs: 10,
        p50DurationMs: 9,
        p95DurationMs: 15,
        p99DurationMs: 20,
      },
    ],
  );

  const stats = await harness.service.getStats(TARGET_ID, "24h");

  assert.equal(stats.availability, 0.97);
  assert.equal(stats.closedIncidents, 2);
  assert.equal(stats.mttrMs, 124);
  assert.equal(stats.latency.length, 1);
  assert.equal(stats.latency[0].p95DurationMs, 15);
});

test("getStats maps each window to its bucket expression and time span", async () => {
  const cases = [
    { requested: "7d" as const, hours: 168, bucket: /toStartOfInterval\(checked_at, INTERVAL 6 HOUR\)/ },
    { requested: "30d" as const, hours: 720, bucket: /toStartOfDay\(checked_at\)/ },
    { requested: "1y" as const, hours: 24, bucket: /toStartOfHour\(checked_at\)/ },
  ];

  for (const { requested, hours, bucket } of cases) {
    const harness = createHarness({
      targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
    });
    harness.queueClickhouseRows([], []);

    const stats = await harness.service.getStats(TARGET_ID, requested);

    assert.equal(stats.window, requested === "1y" ? "24h" : requested, requested);
    assert.match(harness.queries[0].query, new RegExp(`INTERVAL ${hours} HOUR`), requested);
    assert.match(harness.queries[1].query, bucket, requested);
  }
});

test("getStats scopes the MTTR window to the selected trailing window", async () => {
  const harness = createHarness({
    targets: [{ id: TARGET_ID, projectId: PROJECT_ID, name: "Health", url: PUBLIC_URL }],
  });
  harness.queueClickhouseRows([], []);
  const startedAt = Date.now();

  await harness.service.getStats(TARGET_ID, "30d");

  assert.equal(harness.queries[0].query_params.targetId, TARGET_ID);
  assert.equal(harness.queries[1].query_params.targetId, TARGET_ID);
  assert.equal(harness.aggregateCalls.length, 1);
  const call = harness.aggregateCalls[0];
  assert.equal(call.targetId, TARGET_ID);
  const expectedSince = startedAt - 720 * 3_600_000;
  assert.ok(Math.abs(call.gte.getTime() - expectedSince) < 2_000, call.gte.toISOString());
});
