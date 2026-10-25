import { Module } from "@nestjs/common";
import { RemoveController } from "./remove.controller";
import { RemoveService } from "./remove.service";
import { WebMonitorModelsModule } from "../../models/mongo/web-monitor-models.module";
import { WebMonitorClickHouseModule } from "../../models/clickhouse/web-monitor-clickhouse.module";

@Module({
  imports: [WebMonitorModelsModule, WebMonitorClickHouseModule],
  controllers: [RemoveController],
  providers: [RemoveService],
  exports: [RemoveService],
})
export class RemoveModule {}
