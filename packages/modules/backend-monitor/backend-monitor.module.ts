import { Global, Module } from "@nestjs/common";
import { ClickhouseModule } from "@modules/clickhouse/clickhouse.module";
import { BackendMonitorController } from "./backend-monitor.controller";
import { BackendMonitorService } from "./backend-monitor.service";
import { AgentTokenResolver } from "./agent-token.resolver";

/**
 * BackendMonitorModule
 *
 * Server-side ingestion for backend applications. Accepts batched request
 * metrics and error reports authenticated by a SERVER_MONITOR agent token,
 * and stores them in ClickHouse. Query endpoints back the monitoring UI's
 * request/error log lists.
 *
 * ClickHouse DDL lives in the consuming project's clickhouse/migrations
 * directory (ClickHouse has no migration runner).
 */
@Global()
@Module({
  imports: [ClickhouseModule],
  controllers: [BackendMonitorController],
  providers: [BackendMonitorService, AgentTokenResolver],
  exports: [BackendMonitorService],
})
export class BackendMonitorModule {}
