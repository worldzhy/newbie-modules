import { Module } from "@nestjs/common";
import { DayReportNumService } from "./day-report-num.service";
import { WebMonitorModelsModule } from "../../models/mongo/web-monitor-models.module";

@Module({
  imports: [WebMonitorModelsModule],
  providers: [DayReportNumService],
  exports: [DayReportNumService],
})
export class DayReportModule {}
