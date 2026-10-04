import { Global, Module } from "@nestjs/common";
// ScheduleModule.forRoot() is owned by the job-scheduler module when both
// modules are assembled: a second forRoot would register every @Cron twice.
// Shared MongoDB connection module, consumed via the microservices path alias.
import { MongoModule } from "@modules/mongo/mongo.module";
import { RedisModule } from "./models/redis/redis.module";
import { MonitorClickhouseModule } from "./models/clickhouse/monitor-clickhouse.module";
import { SharedModule } from "./shared/shared.module";
import { SiteModule } from "./modules/site/site.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { DayReportModule } from "./modules/day-report/day-report.module";
import { MonitorModelsModule } from "./models/mongo/monitor-models.module";
import { WebModule } from "./modules/web/web.module";
import { RemoveModule } from "./modules/remove/remove.module";

@Global()
@Module({
  imports: [
    MongoModule,
    RedisModule,
    MonitorClickhouseModule,
    MonitorModelsModule,
    SharedModule,
    SiteModule,
    DayReportModule,
    JobsModule,
    WebModule,
    RemoveModule,
  ],
  // WebInstallationService is provided by WebModule (report-side wiring) and
  // re-exported here for consuming projects whose application layer
  // provisions installations (e.g. nightwatch). SiteModule is re-exported so
  // application-layer scheduled jobs can consume SiteService.
  exports: [WebModule, SiteModule],
})
export class WebMonitorModule {}
