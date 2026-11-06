import { Module } from "@nestjs/common";
import { RemoveController } from "./remove.controller";
import { RemoveService } from "./remove.service";
import { WebMonitorModelsModule } from "../../models/mongo/web-monitor-models.module";
import { WebMonitorClickHouseModule } from "../../models/clickhouse/web-monitor-clickhouse.module";
import { WebMonitorAccessService } from "../web/web-monitor-access.service";

@Module({
  imports: [WebMonitorModelsModule, WebMonitorClickHouseModule],
  controllers: [RemoveController],
  providers: [RemoveService, WebMonitorAccessService],
  exports: [RemoveService],
})
export class RemoveModule {}
