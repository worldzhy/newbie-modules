import { Module } from "@nestjs/common";
import { DayReportNumService } from "./day-report-num.service";
import { MonitorModelsModule } from "../../models/mongo/monitor-models.module";

@Module({
  imports: [MonitorModelsModule],
  providers: [DayReportNumService],
  exports: [DayReportNumService],
})
export class DayReportModule {}
