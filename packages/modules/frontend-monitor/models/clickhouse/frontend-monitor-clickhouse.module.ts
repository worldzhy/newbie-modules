import { Global, Module } from "@nestjs/common";
import { FrontendMonitorClickHouseService } from "./frontend-monitor-clickhouse.service";

@Global()
@Module({
  providers: [FrontendMonitorClickHouseService],
  exports: [FrontendMonitorClickHouseService],
})
export class FrontendMonitorClickHouseModule {}
