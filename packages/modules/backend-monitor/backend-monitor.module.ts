import { Global, Module } from "@nestjs/common";
import { InstallationKindRegistry, InstallationKindWire } from "@modules/security/installation/installation-kind";
import { BackendMonitorController } from "./backend-monitor.controller";
import { BackendMonitorService } from "./backend-monitor.service";
import { InstallationController } from "./controllers/installation.controller";
import { MonitorTokenResolver } from "./monitor-token.resolver";
import {
  MonitorInstallationService,
  ONLINE_THRESHOLD_SECONDS,
  REPORT_INTERVAL_SECONDS,
} from "./services/monitor-installation.service";

/**
 * BackendMonitorModule
 *
 * Server-side ingestion for backend applications. Accepts batched request
 * metrics and error reports authenticated by an installation report token from
 * the shared `Installation` table (module/security, ADR-078), and stores them
 * in ClickHouse. Query endpoints back the monitoring UI's request/error log
 * lists. The former ai-analysis sub-feature moved to the consuming project's
 * application layer as project-level "analysis" (ADR-011 in nightwatch-backend)
 * — it spans the project roster, frontend-monitor tables and the llm module,
 * none of which belong to this module's domain.
 *
 * ClickHouse DDL lives in the consuming project's clickhouse/migrations
 * directory (ClickHouse has no migration runner).
 */
@Global()
@Module({
  controllers: [BackendMonitorController, InstallationController],
  providers: [BackendMonitorService, MonitorInstallationService, MonitorTokenResolver],
  // MonitorInstallationService is exported for consuming projects whose
  // application layer provisions installations (e.g. nightwatch).
  exports: [BackendMonitorService, MonitorInstallationService],
})
export class BackendMonitorModule {
  constructor(registry: InstallationKindRegistry) {
    // Declare this collector's kind once (ADR-078 decision 3). Security
    // executes the declaration and holds no backend-monitor-specific constant.
    registry.register({
      kind: InstallationKindWire.BACKEND_MONITOR,
      endpoint: "/backend-monitor/ingest",
      reportIntervalSeconds: REPORT_INTERVAL_SECONDS,
      offlineAfterSeconds: ONLINE_THRESHOLD_SECONDS,
      requiresAppKey: false,
      budget: { perKey: { points: 120, durationSeconds: 60 }, scope: "token" },
      legacyHeader: "x-backend-monitor-token",
    });
  }
}
