import { createClient, type ClickHouseClient } from "@clickhouse/client";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Forward-only ClickHouse migration engine (minimal Flyway semantics).
 *
 * - Migration files live in every assembled module under
 *   `clickhouse/migrations/V<version>__<description>.sql`; the roots are
 *   self-located by callers (src/modules under tsx, dist/src/modules when
 *   compiled), so the engine is host-agnostic. Hosts with application-layer
 *   tables (e.g. url-monitor, nightwatch ADR-022) pass additional roots; all
 *   roots share one history table and one global version sequence.
 * - Each migrated database owns a history table recording version, name and
 *   SHA-256 checksum of every applied file. Applied files are immutable:
 *   checksum drift aborts the run.
 * - ClickHouse DDL is not transactional and the HTTP interface (26.x) rejects
 *   multi-statement payloads, so files are split into individual statements by
 *   {@link splitStatements} and executed one by one. A failed file leaves no
 *   history row and the whole file re-runs on retry; migration DDL must
 *   therefore be idempotent (CREATE/ADD ... IF NOT EXISTS, forward-only).
 */

export interface ClickHouseMigrationConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export interface DiscoveredMigration {
  version: string;
  name: string;
  filename: string;
  filePath: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationPlan {
  applied: AppliedMigration[];
  pending: DiscoveredMigration[];
}

export interface MigrationResult extends MigrationPlan {
  executed: DiscoveredMigration[];
}

interface MigrationLogger {
  (message: string): void;
}

const HISTORY_TABLE = "_clickhouse_schema_migrations";
const MIGRATION_DIR_NAME = "clickhouse/migrations";
// V20261016000000__init_backend_monitor_tables.sql (14 digit timestamp)
const MIGRATION_FILE_PATTERN = /^V(\d{14})__([a-z0-9_]+)\.sql$/;
// Database/table identifiers we generate ourselves must stay injection-safe;
// they only ever come from CLICKHOUSE_DB env and the constant above.
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Split a migration file into individual statements. A top-level semicolon
 * terminates a statement; semicolons inside string literals, quoted
 * identifiers or comments are preserved.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  const flush = (): void => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = "";
  };

  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    // "--" line comment: keep the text up to (but not including) the newline.
    if (char === "-" && next === "-") {
      const lineEnd = sql.indexOf("\n", i);
      const stop = lineEnd === -1 ? sql.length : lineEnd;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // MySQL-style "#" line comment.
    if (char === "#" && (next === undefined || isLineCommentStart(sql, i))) {
      const lineEnd = sql.indexOf("\n", i);
      const stop = lineEnd === -1 ? sql.length : lineEnd;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment (ClickHouse allows nesting). Dropped, but a space is
    // emitted so `CREATE/**/TABLE` cannot collapse into one token.
    if (char === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      current += " ";
      continue;
    }

    // Single-quoted strings, double-quoted and backtick identifiers. Both
    // backslash escapes and doubled quotes ('...''...') are consumed.
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      current += char;
      i += 1;
      while (i < sql.length) {
        const inner = sql[i];
        current += inner;
        i += 1;
        if (inner === "\\" && i < sql.length) {
          current += sql[i];
          i += 1;
          continue;
        }
        if (inner === quote) {
          if (sql[i] === quote) {
            current += sql[i];
            i += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (char === ";") {
      flush();
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }
  flush();
  return statements;
}

// "#" starts a ClickHouse line comment unless it is mid-identifier; DDL files
// only use it at statement starts (possibly after whitespace).
function isLineCommentStart(sql: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /\s/.test(sql[i])) i -= 1;
  return i < 0 || sql[i] === ";";
}

/**
 * Discover migration files across every scanned root:
 * `<root>/<moduleKey>/clickhouse/migrations/V*.sql`. Multiple roots
 * (e.g. the assembled module tree plus a host application tree) are scanned
 * in order and merged. Versions must be globally unique across all roots;
 * results are ordered by version.
 */
export async function discoverMigrations(moduleRoots: string[]): Promise<DiscoveredMigration[]> {
  const discovered: DiscoveredMigration[] = [];

  for (const root of moduleRoots) {
    const moduleDirs = await fs.readdir(root, { withFileTypes: true });

    for (const moduleDir of moduleDirs) {
      if (!moduleDir.isDirectory()) continue;
      const migrationDir = path.join(root, moduleDir.name, MIGRATION_DIR_NAME);
      let entries: string[];
      try {
        entries = await fs.readdir(migrationDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }

      for (const filename of entries) {
        const match = MIGRATION_FILE_PATTERN.exec(filename);
        if (!match) {
          throw new Error(
            `Invalid migration filename '${filename}' in ${moduleDir.name}/${MIGRATION_DIR_NAME}: ` +
              "expected V<YYYYMMDDHHMMSS>__<snake_case_description>.sql",
          );
        }
        const filePath = path.join(migrationDir, filename);
        const sql = await fs.readFile(filePath, "utf8");
        discovered.push({
          version: match[1],
          name: match[2],
          filename,
          filePath,
          sql,
          checksum: crypto.createHash("sha256").update(sql).digest("hex"),
        });
      }
    }
  }

  discovered.sort((a, b) =>
    a.version === b.version ? a.filename.localeCompare(b.filename) : a.version.localeCompare(b.version),
  );

  const seenVersions = new Set<string>();
  for (const migration of discovered) {
    if (seenVersions.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}: ${migration.filename}`);
    }
    seenVersions.add(migration.version);
  }
  return discovered;
}

/** Read the applied-history rows (ordered by version) from the target database. */
export async function readAppliedMigrations(client: ClickHouseClient): Promise<AppliedMigration[]> {
  const result = await client.query({
    // ClickHouse formatDateTime follows MySQL-style specifiers: minute is %i
    // (%M renders the month name).
    query: `SELECT version, name, checksum, formatDateTime(applied_at, '%Y-%m-%d %H:%i:%S') AS appliedAt
            FROM ${HISTORY_TABLE} ORDER BY version`,
    format: "JSONEachRow",
  });
  return (await result.json()) as AppliedMigration[];
}

/** Compute the pending set and validate applied files against the workspace. */
export function planMigrations(discovered: DiscoveredMigration[], applied: AppliedMigration[]): MigrationPlan {
  const byVersion = new Map(discovered.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const migration = byVersion.get(row.version);
    if (!migration) {
      throw new Error(
        `Migration ${row.version} (${row.name}) is recorded as applied but its file no longer exists. ` +
          "Applied migrations are immutable; restore the file instead of removing it.",
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${migration.filename}: ` +
          "the file was modified after being applied. Add a new forward migration instead of editing it.",
      );
    }
  }

  const pending = discovered.filter((migration) => !applied.some((row) => row.version === migration.version));
  if (applied.length > 0 && pending.length > 0) {
    const latestApplied = applied[applied.length - 1].version;
    const outOfOrder = pending.find((migration) => migration.version < latestApplied);
    if (outOfOrder) {
      throw new Error(
        `Out-of-order migration ${outOfOrder.filename}: its version is older than the latest applied version ${latestApplied}.`,
      );
    }
  }

  return { applied, pending };
}

/**
 * Ensure the target database exists. Uses a connection without a default
 * database so a fresh ClickHouse volume (before first connection) bootstraps
 * cleanly.
 */
async function ensureDatabase(config: ClickHouseMigrationConfig): Promise<void> {
  if (!IDENTIFIER_PATTERN.test(config.database)) {
    throw new Error(`Unsafe CLICKHOUSE_DB value '${config.database}': expected [A-Za-z0-9_]+`);
  }
  const bootstrap = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
  });
  try {
    await bootstrap.command({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });
  } finally {
    await bootstrap.close();
  }
}

async function ensureHistoryTable(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE}
      (
          version    String,
          name       String,
          checksum   String,
          applied_at DateTime64(3, 'UTC') DEFAULT now64()
      )
      ENGINE = MergeTree()
      ORDER BY version`,
  });
}

/**
 * The slice of the ClickHouse client the execution loop needs. Deliberately
 * narrow: the loop only issues statements and records history rows. This is
 * not a product-level driver abstraction — there is one driver, and the DDL
 * itself still needs a real server to verify (see the e2e smoke test).
 */
export type MigrationExecutor = Pick<ClickHouseClient, "command" | "insert">;

/** Run fn against a connected client scoped to the target database. */
async function withClient<T>(
  config: ClickHouseMigrationConfig,
  fn: (client: ClickHouseClient) => Promise<T>,
): Promise<T> {
  await ensureDatabase(config);
  const client = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
  });
  try {
    await ensureHistoryTable(client);
    return await fn(client);
  } finally {
    await client.close();
  }
}

/**
 * Execute a plan against an already-connected executor and return the files
 * applied in this run. Statements run in file order; the history row is
 * written only after the whole file succeeds, so a partial failure re-runs
 * the idempotent file on the next attempt.
 */
export async function runPlan(
  executor: MigrationExecutor,
  plan: MigrationPlan,
  log: MigrationLogger = () => undefined,
): Promise<DiscoveredMigration[]> {
  const executed: DiscoveredMigration[] = [];
  for (const migration of plan.pending) {
    log(`Applying ${migration.filename}`);
    const statements = splitStatements(migration.sql);
    if (statements.length === 0) {
      throw new Error(`Migration ${migration.filename} contains no executable statements.`);
    }
    for (const statement of statements) {
      await executor.command({ query: statement });
    }
    await executor.insert({
      table: HISTORY_TABLE,
      columns: ["version", "name", "checksum"],
      values: [{ version: migration.version, name: migration.name, checksum: migration.checksum }],
      format: "JSONEachRow",
    });
    executed.push(migration);
  }
  return executed;
}

/**
 * Validate and apply every pending migration. Returns the full plan plus the
 * list of files executed in this run.
 */
export async function runMigrations(
  config: ClickHouseMigrationConfig,
  moduleRoots: string[],
  log: MigrationLogger = () => undefined,
): Promise<MigrationResult> {
  if (!config.database) {
    throw new Error("CLICKHOUSE_DB is not set; the migration runner needs an explicit target database.");
  }
  return withClient(config, async (client) => {
    const discovered = await discoverMigrations(moduleRoots);
    const applied = await readAppliedMigrations(client);
    const plan = planMigrations(discovered, applied);
    const executed = await runPlan(client, plan, log);

    if (executed.length === 0) {
      log(`Already up to date (${applied.length} applied)`);
    } else {
      log(`Applied ${executed.length} migration(s); ${applied.length + executed.length} total`);
    }
    return { applied, pending: plan.pending, executed };
  });
}

/** Read-only view used by the `status` command. */
export async function getMigrationStatus(
  config: ClickHouseMigrationConfig,
  moduleRoots: string[],
): Promise<MigrationPlan & { database: string }> {
  if (!config.database) {
    throw new Error("CLICKHOUSE_DB is not set; the migration runner needs an explicit target database.");
  }
  return withClient(config, async (client) => {
    const discovered = await discoverMigrations(moduleRoots);
    const applied = await readAppliedMigrations(client);
    return { ...planMigrations(discovered, applied), database: config.database };
  });
}
