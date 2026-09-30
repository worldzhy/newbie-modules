import { Global, Module } from "@nestjs/common";
import { ClickhouseModule } from "@modules/clickhouse/clickhouse.module";
import { BackendMonitorController } from "./backend-monitor.controller";
import { BackendMonitorService } from "./backend-monitor.service";
import { BackendMonitorInstallationsController } from "./controllers/installations.controller";
import { MonitorTokenResolver } from "./monitor-token.resolver";
import { MonitorInstallationService } from "./services/monitor-installation.service";

/**
 * BackendMonitorModule
 *
 * Server-side ingestion for backend applications. Accepts batched request
 * metrics and error reports authenticated by a MonitorInstallation report
 * token (module-hub design §9.2, Phase 3 pilot — the module owns its token
 * table instead of reading application.Agent/SERVER_MONITOR), and stores
 * them in ClickHouse. Query endpoints back the monitoring UI's request/error
 * log lists.
 *
 * ClickHouse DDL lives in the consuming project's clickhouse/migrations
 * directory (ClickHouse has no migration runner).
 */
@Global()
@Module({
  imports: [ClickhouseModule],
  controllers: [BackendMonitorController, BackendMonitorInstallationsController],
  providers: [BackendMonitorService, MonitorInstallationService, MonitorTokenResolver],
  // MonitorInstallationService is exported for consuming projects whose
  // application layer provisions installations (e.g. nightwatch).
  exports: [BackendMonitorService, MonitorInstallationService],
})
export class BackendMonitorModule {}
