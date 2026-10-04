import { Global, Module } from "@nestjs/common";
// ScheduleModule.forRoot() is owned by the job-scheduler module when both
// modules are assembled: a second forRoot would register every @Cron twice.
// Shared MongoDB connection module, consumed via the microservices path alias.
import { MongoModule } from "@modules/mongo/mongo.module";
import { RedisModule } from "./models/redis/redis.module";
import { MonitorClickhouseModule } from "./models/clickhouse/monitor-clickhouse.module";
import { SharedModule } from "./shared/shared.module";
import { SystemModule } from "./modules/system/system.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { DayReportModule } from "./modules/day-report/day-report.module";
import { MonitorModelsModule } from "./models/mongo/monitor-models.module";
import { WebModule } from "./modules/web/web.module";
import { RemoveModule } from "./modules/remove/remove.module";
import { WebInstallationService } from "./services/web-installation.service";
import { WebTokenResolver } from "./services/web-token.resolver";

@Global()
@Module({
  imports: [
    MongoModule,
    RedisModule,
    MonitorClickhouseModule,
    MonitorModelsModule,
    SharedModule,
    SystemModule,
    DayReportModule,
    JobsModule,
    WebModule,
    RemoveModule,
  ],
  providers: [WebInstallationService, WebTokenResolver],
  // WebInstallationService is exported for consuming projects whose
  // application layer provisions installations (e.g. nightwatch).
  exports: [WebInstallationService],
})
export class WebMonitorModule {}
