import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MonitorClickhouseModule } from "../../models/clickhouse/monitor-clickhouse.module";
import { MonitorModelsModule } from "../../models/mongo/monitor-models.module";
import { SharedModule } from "../../shared/shared.module";
import { DayReportModule } from "../../modules/day-report/day-report.module";
import { RedisModule } from "../../models/redis/redis.module";
import { SystemModule } from "../../modules/system/system.module";
import { WebInstallationService } from "../../services/web-installation.service";
import { WebTokenResolver } from "../../services/web-token.resolver";

import { WebReportController } from "./report.controller";

import { AjaxController } from "./ajax.controller";
import { ErrorController } from "./error.controller";
import { PageController } from "./page.controller";
import { ResourceController } from "./resource.controller";
import { EnvironmentController } from "./environment.controller";
import { CustomController } from "./custom.controller";
import { PvuvipController } from "./pvuvip.controller";
import { AnalysisController } from "./analysis.controller";
import { AjaxService } from "./services/ajax.service";
import { ErrorService } from "./services/error.service";
import { PageService } from "./services/page.service";
import { ResourceService } from "./services/resource.service";
import { EnvironmentService } from "./services/environment.service";
import { AnalysisService } from "./services/analysis.service";
import { PvuvipService } from "./services/pvuvip.service";
import { WebCustomService } from "./services/custom.service";
import { WebReportTaskService } from "./services/report-task.service";
import { WebPvuvipTaskService } from "./services/pvuvip-task.service";
import { WebIpTaskService } from "./services/ip-task.service";

@Module({
  imports: [
    ConfigModule,
    MonitorClickhouseModule,
    MonitorModelsModule,
    SharedModule,
    DayReportModule,
    RedisModule,
    SystemModule,
  ],
  controllers: [
    WebReportController,
    AjaxController,
    ErrorController,
    PageController,
    ResourceController,
    EnvironmentController,
    CustomController,
    PvuvipController,
    AnalysisController,
  ],
  providers: [
    AjaxService,
    ErrorService,
    PageService,
    ResourceService,
    EnvironmentService,
    AnalysisService,
    PvuvipService,
    WebCustomService,
    WebReportTaskService,
    WebPvuvipTaskService,
    WebIpTaskService,
    // Installation identity lives here (not on the root WebMonitorModule) so
    // WebReportController can resolve WebTokenResolver without a module cycle.
    WebInstallationService,
    WebTokenResolver,
  ],
  // WebInstallationService is re-exported by the root WebMonitorModule for
  // consuming projects whose application layer provisions installations.
  exports: [WebReportTaskService, WebPvuvipTaskService, WebIpTaskService, WebInstallationService],
})
export class WebModule {}
