import {Global, Module} from '@nestjs/common';
import {MonitorModelsService} from './monitor-models.service';

/**
 * Frontend-monitor MongoDB model factory.
 *
 * The Mongoose connection itself is owned by the shared MongoModule
 * (@microservices/mongo). This module only exposes the business-scoped
 * MonitorModelsService, which lazily creates the static and per-appId
 * (dynamic collection) models on top of the shared default connection.
 */
@Global()
@Module({
  providers: [MonitorModelsService],
  exports: [MonitorModelsService],
})
export class MonitorModelsModule {}
