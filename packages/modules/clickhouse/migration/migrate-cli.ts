#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { getMigrationStatus, runMigrations, type ClickHouseMigrationConfig } from "./migration-runner";

/**
 * Deployment/standalone frontend for the ClickHouse migration engine.
 *
 * Production entry (compiled):
 *   node dist/src/modules/clickhouse/migration/migrate-cli.js deploy
 *   node dist/src/modules/clickhouse/migration/migrate-cli.js status
 *
 * Runs outside any NestJS context, so connection settings are read straight
 * from CLICKHOUSE_* env vars (same names as the clickhouse module config).
 * When invoked from a project checkout (npm script / tsx) a root `.env` file
 * is parsed for keys absent from the environment; real environment variables
 * always win.
 */

// Default module root: this file lives at
// <moduleRoot>/clickhouse/migration/migrate-cli.(ts|js) in both the source
// tree (src/modules) and the compiled tree (dist/src/modules).
const DEFAULT_MODULE_ROOT = path.resolve(__dirname, "..", "..");

export interface MigrateCliOptions {
  cwd: string;
  moduleRoots?: string[];
}

/** Minimal .env parser (KEY=VALUE lines, `export ` prefix, quotes, comments). */
export function loadDotEnv(cwd: string): void {
  const envPath = path.join(cwd, ".env");
  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const equalsIndex = withoutExport.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = withoutExport.slice(0, equalsIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = withoutExport.slice(equalsIndex + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function resolveConfig(cwd: string): ClickHouseMigrationConfig {
  loadDotEnv(cwd);
  return {
    url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    database: process.env.CLICKHOUSE_DB || "",
  };
}

export async function runMigrateCli(argv: string[], options: MigrateCliOptions): Promise<number> {
  const command = argv[0];
  // Repeatable flag: hosts with application-layer migration directories pass
  // one --modules-root per tree; all roots share one history table.
  const rootArguments = argv
    .filter((arg) => arg.startsWith("--modules-root="))
    .map((arg) => arg.slice("--modules-root=".length));
  const moduleRoots = rootArguments.length > 0 ? rootArguments : (options.moduleRoots ?? [DEFAULT_MODULE_ROOT]);
  const cwd = options.cwd;
  const config = resolveConfig(cwd);
  const log = (message: string): void => console.log(`[clickhouse-migrate] ${message}`);

  if (command === "deploy") {
    const result = await runMigrations(config, moduleRoots, log);
    for (const migration of result.executed) {
      console.log(`  applied ${migration.version} ${migration.name}`);
    }
    return 0;
  }

  if (command === "status") {
    const status = await getMigrationStatus(config, moduleRoots);
    console.log(`Database:  ${status.database}`);
    console.log(`Applied:   ${status.applied.length}`);
    for (const row of status.applied) {
      console.log(`  [x] ${row.version} ${row.name} (${row.appliedAt})`);
    }
    console.log(`Pending:   ${status.pending.length}`);
    for (const migration of status.pending) {
      console.log(`  [ ] ${migration.version} ${migration.name} (${migration.filename})`);
    }
    return 0;
  }

  console.error(`Unknown command '${command ?? ""}'. Usage: migrate-cli deploy|status`);
  return 2;
}

if (require.main === module) {
  runMigrateCli(process.argv.slice(2), { cwd: process.cwd() })
    .then((exitCode) => process.exit(exitCode))
    .catch((error: unknown) => {
      console.error(`[clickhouse-migrate] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
