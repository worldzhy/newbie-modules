import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discoverMigrations,
  planMigrations,
  splitStatements,
  type AppliedMigration,
  type DiscoveredMigration,
} from "./migration-runner";

function migration(overrides: Partial<DiscoveredMigration> = {}): DiscoveredMigration {
  return {
    version: "20261016000000",
    name: "init",
    filename: "V20261016000000__init.sql",
    filePath: "/tmp/V20261016000000__init.sql",
    sql: "SELECT 1",
    checksum: "abc",
    ...overrides,
  };
}

function applied(overrides: Partial<AppliedMigration> = {}): AppliedMigration {
  return {
    version: "20261016000000",
    name: "init",
    checksum: "abc",
    appliedAt: "2026-10-16 00:00:00",
    ...overrides,
  };
}

describe("splitStatements", () => {
  it("splits on top-level semicolons and drops empties", () => {
    assert.deepEqual(splitStatements("SELECT 1; SELECT 2;"), ["SELECT 1", "SELECT 2"]);
    assert.deepEqual(splitStatements("  ;  "), []);
  });

  it("keeps semicolons inside single-quoted strings", () => {
    assert.deepEqual(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 2"), [
      "INSERT INTO t VALUES ('a;b')",
      "SELECT 2",
    ]);
  });

  it("honours backslash escapes and doubled quotes in strings", () => {
    assert.deepEqual(splitStatements("SELECT 'it''s;x'; SELECT 'a\\';b'"), [
      "SELECT 'it''s;x'",
      "SELECT 'a\\';b'",
    ]);
  });

  it("keeps semicolons inside double-quoted and backtick identifiers", () => {
    assert.deepEqual(splitStatements('SELECT "weird;name" FROM `t;1`; SELECT 2', ), [
      'SELECT "weird;name" FROM `t;1`',
      "SELECT 2",
    ]);
  });

  it("does not split on semicolons in line or block comments", () => {
    const sql = `
      -- a;b
      SELECT 1; /* x; y */ SELECT 2;
      # hash; comment
      SELECT 3;
    `;
    assert.deepEqual(splitStatements(sql), ["-- a;b\n      SELECT 1", "SELECT 2", "# hash; comment\n      SELECT 3"]);
  });

  it("tracks nested block comments", () => {
    const statements = splitStatements("SELECT /* outer /* inner */ ; */ 1; SELECT 2");
    assert.equal(statements.length, 2);
    assert.ok(statements[0].includes("SELECT"));
  });
});

describe("planMigrations", () => {
  it("returns applied rows and pending files in order", () => {
    const discovered = [
      migration(),
      migration({ version: "20261017000000", name: "second", filename: "V20261017000000__second.sql", checksum: "def" }),
    ];
    const plan = planMigrations(discovered, [applied()]);
    assert.equal(plan.applied.length, 1);
    assert.deepEqual(plan.pending.map((migration) => migration.version), ["20261017000000"]);
  });

  it("rejects a missing file for a recorded migration", () => {
    assert.throws(
      () => planMigrations([migration()], [applied({ version: "20260901000000", name: "ghost" })]),
      /no longer exists/,
    );
  });

  it("rejects checksum drift on an applied file", () => {
    assert.throws(
      () => planMigrations([migration({ checksum: "changed" })], [applied()]),
      /Checksum mismatch/,
    );
  });

  it("rejects out-of-order pending versions", () => {
    const discovered = [
      migration({ version: "20261016000000" }),
      migration({
        version: "20261015000000",
        name: "late",
        filename: "V20261015000000__late.sql",
        checksum: "old",
      }),
    ];
    assert.throws(() => planMigrations(discovered, [applied()]), /Out-of-order/);
  });
});

describe("discoverMigrations", () => {
  it("accepts files from multiple modules and orders by version", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ch-migrations-"));
    try {
      await fs.mkdir(path.join(root, "module-b", "clickhouse-migrations"), { recursive: true });
      await fs.mkdir(path.join(root, "module-a", "clickhouse-migrations"), { recursive: true });
      await fs.writeFile(
        path.join(root, "module-b", "clickhouse-migrations", "V20261017000000__second.sql"),
        "SELECT 2",
      );
      await fs.writeFile(
        path.join(root, "module-a", "clickhouse-migrations", "V20261016000000__first.sql"),
        "SELECT 1",
      );

      const found = await discoverMigrations(root);
      assert.deepEqual(
        found.map((migration) => [migration.version, migration.name]),
        [
          ["20261016000000", "first"],
          ["20261017000000", "second"],
        ],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid filenames", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ch-migrations-bad-"));
    try {
      const dir = path.join(root, "module-x", "clickhouse-migrations");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "bad-name.sql"), "SELECT 1");
      await assert.rejects(discoverMigrations(root), /Invalid migration filename/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
