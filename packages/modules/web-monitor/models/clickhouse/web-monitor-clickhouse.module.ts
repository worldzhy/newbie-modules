import { Global, Module } from "@nestjs/common";
import { WebMonitorClickHouseService } from "./web-monitor-clickhouse.service";

@Global()
@Module({
  providers: [WebMonitorClickHouseService],
  exports: [WebMonitorClickHouseService],
})
export class WebMonitorClickHouseModule {}
