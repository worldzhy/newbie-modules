import { Module } from "@nestjs/common";
import { SiteService } from "./site.service";
import { SiteController } from "./site.controller";
import { NodeCacheService } from "../../shared/node-cache.service";
import { WebMonitorModelsModule } from "../../models/mongo/web-monitor-models.module";

// Models are created lazily by WebMonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [WebMonitorModelsModule],
  controllers: [SiteController],
  providers: [SiteService, NodeCacheService],
  exports: [SiteService, NodeCacheService],
})
export class SiteModule {}
