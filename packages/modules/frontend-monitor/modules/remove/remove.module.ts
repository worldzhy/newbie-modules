import { Module } from "@nestjs/common";
import { RemoveController } from "./remove.controller";
import { RemoveService } from "./remove.service";
import { FrontendMonitorModelsModule } from "../../models/mongo/frontend-monitor-models.module";
import { FrontendMonitorClickHouseModule } from "../../models/clickhouse/frontend-monitor-clickhouse.module";
import { FrontendMonitorAccessService } from "../web/frontend-monitor-access.service";

@Module({
  imports: [FrontendMonitorModelsModule, FrontendMonitorClickHouseModule],
  controllers: [RemoveController],
  providers: [RemoveService, FrontendMonitorAccessService],
  exports: [RemoveService],
})
export class RemoveModule {}
