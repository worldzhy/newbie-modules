import { Module } from "@nestjs/common";
import { FrontendMonitorClickHouseModule } from "../../models/clickhouse/frontend-monitor-clickhouse.module";
import { FrontendMonitorModelsModule } from "../../models/mongo/frontend-monitor-models.module";
import { SharedModule } from "../../shared/shared.module";
import { DayReportModule } from "@modules/frontend-monitor/modules/day-report/day-report.module";
import { SiteModule } from "@modules/frontend-monitor/modules/site/site.module";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";
import { FrontendInstallationService } from "../../services/frontend-installation.service";
import { FrontendTokenResolver } from "../../services/frontend-token.resolver";

import { FrontendReportController } from "./report.controller";

import { AjaxController } from "./ajax.controller";
import { ErrorController } from "./error.controller";
import { PageController } from "./page.controller";
import { ResourceController } from "./resource.controller";
import { EnvironmentController } from "./environment.controller";
import { CustomController } from "./custom.controller";
import { PvuvipController } from "./pvuvip.controller";
import { FrontendMonitorAnalysisController } from "./analysis.controller";
import { AjaxService } from "./services/ajax.service";
import { ErrorService } from "./services/error.service";
import { PageService } from "./services/page.service";
import { ResourceService } from "./services/resource.service";
import { EnvironmentService } from "./services/environment.service";
import { FrontendMonitorAnalysisService } from "./services/analysis.service";
import { PvuvipService } from "./services/pvuvip.service";
import { WebCustomService } from "./services/custom.service";
import { FrontendReportTaskService } from "./services/report-task.service";
import { FrontendPvuvipTaskService } from "./services/pvuvip-task.service";
import { FrontendIpTaskService } from "./services/ip-task.service";
import { FrontendMonitorAccessService } from "./frontend-monitor-access.service";

@Module({
  imports: [FrontendMonitorClickHouseModule, FrontendMonitorModelsModule, SharedModule, DayReportModule, SiteModule],
  controllers: [
    FrontendReportController,
    AjaxController,
    ErrorController,
    PageController,
    ResourceController,
    EnvironmentController,
    CustomController,
    PvuvipController,
    FrontendMonitorAnalysisController,
  ],
  providers: [
    AjaxService,
    ErrorService,
    PageService,
    ResourceService,
    EnvironmentService,
    FrontendMonitorAnalysisService,
    PvuvipService,
    WebCustomService,
    FrontendReportTaskService,
    FrontendPvuvipTaskService,
    FrontendIpTaskService,
    FrontendMonitorAccessService,
    // Installation identity lives here (not on the root FrontendMonitorModule) so
    // FrontendReportController can resolve FrontendTokenResolver without a module cycle.
    FrontendInstallationService,
    FrontendTokenResolver,
    // Bind the report-token resolver to security's SPI port (ADR-016);
    // useExisting keeps the singleton so the token cache is never duplicated.
    { provide: installationResolverToken("frontend-monitor"), useExisting: FrontendTokenResolver },
  ],
  // FrontendInstallationService is re-exported by the root FrontendMonitorModule for
  // consuming projects whose application layer provisions installations.
  // PvuvipService/PageService/FrontendMonitorAnalysisService are read services exported for
  // consuming-project application layers that read aggregated web metrics
  // (e.g. the nightwatch copilot frontend-monitoring data source).
  exports: [
    FrontendReportTaskService,
    FrontendPvuvipTaskService,
    FrontendIpTaskService,
    FrontendInstallationService,
    PvuvipService,
    PageService,
    FrontendMonitorAnalysisService,
    installationResolverToken("frontend-monitor"),
  ],
})
export class WebModule {}
