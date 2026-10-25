import { Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { SiteModule } from "@modules/web-monitor/modules/site/site.module";

import { DayReportModule } from "@modules/web-monitor/modules/day-report/day-report.module";
import { WebMonitorClickHouseModule } from "../../models/clickhouse/web-monitor-clickhouse.module";

import { WebModule } from "@modules/web-monitor/modules/web/web.module";

// WebPvuvip is created lazily by WebMonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [SiteModule, DayReportModule, WebMonitorClickHouseModule, WebModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
