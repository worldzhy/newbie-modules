import { Module } from "@nestjs/common";
import { DayReportNumService } from "./day-report-num.service";
import { FrontendMonitorModelsModule } from "../../models/mongo/frontend-monitor-models.module";

@Module({
  imports: [FrontendMonitorModelsModule],
  providers: [DayReportNumService],
  exports: [DayReportNumService],
})
export class DayReportModule {}
