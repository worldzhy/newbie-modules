import { Global, Module } from "@nestjs/common";
import { InstallationKindRegistry, InstallationKindWire } from "@modules/security/installation/installation-kind";
// ScheduleModule.forRoot() is owned by the job-scheduler module when both
// modules are assembled: a second forRoot would register every @Cron twice.
import { FrontendMonitorClickHouseModule } from "./models/clickhouse/frontend-monitor-clickhouse.module";
import { SharedModule } from "./shared/shared.module";
import { SiteModule } from "./modules/site/site.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { DayReportModule } from "./modules/day-report/day-report.module";
import { FrontendMonitorModelsModule } from "./models/mongo/frontend-monitor-models.module";
import { WebModule } from "./modules/web/web.module";
import { RemoveModule } from "./modules/remove/remove.module";

@Global()
@Module({
  imports: [
    FrontendMonitorClickHouseModule,
    FrontendMonitorModelsModule,
    SharedModule,
    SiteModule,
    DayReportModule,
    JobsModule,
    WebModule,
    RemoveModule,
  ],
  // FrontendMonitorInstallationService is provided by WebModule (report-side wiring) and
  // re-exported here for consuming projects whose application layer
  // provisions installations (e.g. nightwatch). SiteModule is re-exported so
  // application-layer scheduled jobs can consume SiteService.
  exports: [WebModule, SiteModule],
})
export class FrontendMonitorModule {
  constructor(registry: InstallationKindRegistry) {
    // Browser tokens are public by nature, so the first budget layer keys by
    // token AND source IP; a second layer caps the whole installation so one
    // runaway site cannot exhaust the shared ingest queue (ADR-079).
    registry.register({
      kind: InstallationKindWire.FRONTEND_MONITOR,
      endpoint: "/frontend-monitor/reports",
      reportIntervalSeconds: 10,
      offlineAfterSeconds: 180,
      requiresAppKey: true,
      budget: {
        perKey: { points: 120, durationSeconds: 60 },
        scope: "token-and-ip",
        perInstallationTotal: { points: 6000, durationSeconds: 60 },
      },
      // sendBeacon posts text/plain, so the token rides in the body as well.
      bodyTokenField: "token",
    });
  }
}
