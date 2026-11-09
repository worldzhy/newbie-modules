import { Module } from "@nestjs/common";

import { UrlCheckController } from "./url-check.controller";
import { UrlCheckProbeService } from "./url-check-probe.service";
import { UrlCheckService } from "./url-check.service";

/**
 * Active external URL availability checks (formerly url-monitor, ADR-022).
 *
 * Every active target in Postgres is probed on the host's 60s cadence; raw
 * results land in ClickHouse (schema in clickhouse/migrations/) and the
 * per-target alert state machine advances in the same Prisma transaction as
 * the rolling columns (consecutiveFailures / consecutiveSuccesses /
 * isAlertOpen / incident rows).
 *
 * Down/recovered transitions emit url-check.down and url-check.recovered
 * events via EventEmitter2; alarm routing is the host application's job.
 * UrlCheckService is exported so the host can expose project-dimension
 * listings (resolving a project to its eligible groups is host domain
 * knowledge; the module itself only speaks groupId).
 */
@Module({
  controllers: [UrlCheckController],
  providers: [UrlCheckService, UrlCheckProbeService],
  exports: [UrlCheckService, UrlCheckProbeService],
})
export class UrlCheckModule {}
