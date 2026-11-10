import { Global, Module } from "@nestjs/common";
import { FrontendMonitorModelsService } from "./frontend-monitor-models.service";

/**
 * Frontend-monitor MongoDB model factory.
 *
 * The Mongoose connection itself is owned by the shared MongoModule
 * (@modules/mongo). This module only exposes the business-scoped
 * FrontendMonitorModelsService, which lazily creates the static and per-appId
 * (dynamic collection) models on top of the shared default connection.
 */
@Global()
@Module({
  providers: [FrontendMonitorModelsService],
  exports: [FrontendMonitorModelsService],
})
export class FrontendMonitorModelsModule {}
