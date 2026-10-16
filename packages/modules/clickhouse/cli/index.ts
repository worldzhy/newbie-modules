/**
 * Development-time CLI namespace, loaded by the newbie CLI's module-CLI
 * extension point (the `cli` field in newbie.module.json):
 *
 *   newbie clickhouse migrate   apply pending ClickHouse migrations
 *   newbie clickhouse status    show applied / pending migrations
 *
 * The deployment-time entry is the compiled migrate-cli (run by the
 * ch-migrate compose service); both frontends share the same engine.
 */
import type { Command } from "commander";

import { runMigrateCli, type CliOptions } from "../migration/migrate-cli";

export function register(parent: Command, options: { cwd: string }): void {
  const run = (command: string) => (): Promise<void> =>
    runMigrateCli([command], options as CliOptions)
      .then((exitCode) => {
        if (exitCode !== 0) process.exitCode = exitCode;
      })
      .catch((error: unknown) => {
        console.error(`[clickhouse-migrate] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });

  parent
    .command("migrate")
    .description("Apply pending forward-only ClickHouse migrations from installed modules")
    .action(run("deploy"));

  parent.command("status").description("Show applied and pending ClickHouse migrations").action(run("status"));
}
