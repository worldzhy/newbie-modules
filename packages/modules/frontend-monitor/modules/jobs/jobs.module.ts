import { Module } from "@nestjs/common";
import { JobsService } from "./jobs.service";
import { SiteModule } from "@modules/frontend-monitor/modules/site/site.module";

import { DayReportModule } from "@modules/frontend-monitor/modules/day-report/day-report.module";
import { FrontendMonitorClickHouseModule } from "../../models/clickhouse/frontend-monitor-clickhouse.module";

import { WebModule } from "@modules/frontend-monitor/modules/web/web.module";

// WebPvuvip is created lazily by FrontendMonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [SiteModule, DayReportModule, FrontendMonitorClickHouseModule, WebModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
