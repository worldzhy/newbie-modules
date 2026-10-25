import { Module } from "@nestjs/common";
import { WebMonitorClickHouseModule } from "../../models/clickhouse/web-monitor-clickhouse.module";
import { WebMonitorModelsModule } from "../../models/mongo/web-monitor-models.module";
import { SharedModule } from "../../shared/shared.module";
import { DayReportModule } from "@modules/web-monitor/modules/day-report/day-report.module";
import { SiteModule } from "@modules/web-monitor/modules/site/site.module";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";
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
import { WebMonitorAnalysisController } from "./analysis.controller";
import { AjaxService } from "./services/ajax.service";
import { ErrorService } from "./services/error.service";
import { PageService } from "./services/page.service";
import { ResourceService } from "./services/resource.service";
import { EnvironmentService } from "./services/environment.service";
import { WebMonitorAnalysisService } from "./services/analysis.service";
import { PvuvipService } from "./services/pvuvip.service";
import { WebCustomService } from "./services/custom.service";
import { WebReportTaskService } from "./services/report-task.service";
import { WebPvuvipTaskService } from "./services/pvuvip-task.service";
import { WebIpTaskService } from "./services/ip-task.service";

@Module({
  imports: [WebMonitorClickHouseModule, WebMonitorModelsModule, SharedModule, DayReportModule, SiteModule],
  controllers: [
    WebReportController,
    AjaxController,
    ErrorController,
    PageController,
    ResourceController,
    EnvironmentController,
    CustomController,
    PvuvipController,
    WebMonitorAnalysisController,
  ],
  providers: [
    AjaxService,
    ErrorService,
    PageService,
    ResourceService,
    EnvironmentService,
    WebMonitorAnalysisService,
    PvuvipService,
    WebCustomService,
    WebReportTaskService,
    WebPvuvipTaskService,
    WebIpTaskService,
    // Installation identity lives here (not on the root WebMonitorModule) so
    // WebReportController can resolve WebTokenResolver without a module cycle.
    WebInstallationService,
    WebTokenResolver,
    // Bind the report-token resolver to security's SPI port (ADR-016);
    // useExisting keeps the singleton so the token cache is never duplicated.
    { provide: installationResolverToken("web-monitor"), useExisting: WebTokenResolver },
  ],
  // WebInstallationService is re-exported by the root WebMonitorModule for
  // consuming projects whose application layer provisions installations.
  // PvuvipService/PageService/WebMonitorAnalysisService are read services exported for
  // consuming-project application layers that read aggregated web metrics
  // (e.g. the nightwatch copilot frontend-monitoring data source).
  exports: [
    WebReportTaskService,
    WebPvuvipTaskService,
    WebIpTaskService,
    WebInstallationService,
    PvuvipService,
    PageService,
    WebMonitorAnalysisService,
    installationResolverToken("web-monitor"),
  ],
})
export class WebModule {}
