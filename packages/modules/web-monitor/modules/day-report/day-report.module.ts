import { Module } from "@nestjs/common";
import { DayReportNumService } from "./day-report-num.service";
import { RedisModule } from "../../models/redis/redis.module";
import { MonitorModelsModule } from "../../models/mongo/monitor-models.module";

@Module({
  imports: [RedisModule, MonitorModelsModule],
  providers: [DayReportNumService],
  exports: [DayReportNumService],
})
export class DayReportModule {}
