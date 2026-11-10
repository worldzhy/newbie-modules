import { Module } from "@nestjs/common";
import { SiteService } from "./site.service";
import { SiteController } from "./site.controller";
import { NodeCacheService } from "../../shared/node-cache.service";
import { FrontendMonitorModelsModule } from "../../models/mongo/frontend-monitor-models.module";
import { FrontendMonitorAccessService } from "../web/frontend-monitor-access.service";

// Models are created lazily by FrontendMonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [FrontendMonitorModelsModule],
  controllers: [SiteController],
  providers: [SiteService, NodeCacheService, FrontendMonitorAccessService],
  exports: [SiteService, NodeCacheService],
})
export class SiteModule {}
