import { Global, Module } from "@nestjs/common";
import { WebMonitorClickhouseService } from "./web-monitor-clickhouse.service";

@Global()
@Module({
  providers: [WebMonitorClickhouseService],
  exports: [WebMonitorClickhouseService],
})
export class WebMonitorClickhouseModule {}
