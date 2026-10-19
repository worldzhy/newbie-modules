import { Global, Module } from "@nestjs/common";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";
import { BackendMonitorController } from "./backend-monitor.controller";
import { BackendMonitorService } from "./backend-monitor.service";
import { InstallationController } from "./controllers/installation.controller";
import { MonitorTokenResolver } from "./monitor-token.resolver";
import { MonitorInstallationService } from "./services/monitor-installation.service";

/**
 * BackendMonitorModule
 *
 * Server-side ingestion for backend applications. Accepts batched request
 * metrics and error reports authenticated by a BackendMonitorInstallation report
 * token (module-hub design §9.2, Phase 3 pilot — the module owns its token
 * table instead of reading application.Agent/SERVER_MONITOR), and stores
 * them in ClickHouse. Query endpoints back the monitoring UI's request/error
 * log lists. The former ai-analysis sub-feature moved to the consuming
 * project's application layer as project-level "analysis" (ADR-011 in
 * nightwatch-backend) — it spans the project roster, web-monitor tables and
 * the llm module, none of which belong to this module's domain.
 *
 * ClickHouse DDL lives in the consuming project's clickhouse/migrations
 * directory (ClickHouse has no migration runner).
 */
@Global()
@Module({
  controllers: [BackendMonitorController, InstallationController],
  providers: [
    BackendMonitorService,
    MonitorInstallationService,
    MonitorTokenResolver,
    // Bind the report-token resolver to security's SPI port (ADR-016);
    // useExisting keeps the singleton so the token cache is never duplicated.
    { provide: installationResolverToken("backend-monitor"), useExisting: MonitorTokenResolver },
  ],
  // MonitorInstallationService is exported for consuming projects whose
  // application layer provisions installations (e.g. nightwatch).
  exports: [BackendMonitorService, MonitorInstallationService, installationResolverToken("backend-monitor")],
})
export class BackendMonitorModule {}
