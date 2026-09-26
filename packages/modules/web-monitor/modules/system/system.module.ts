import {Module} from '@nestjs/common';
import {SystemService} from './system.service';
import {SystemController} from './system.controller';
import {NodeCacheService} from '../../shared/node-cache.service';
import {MonitorModelsModule} from '../../models/mongo/monitor-models.module';

// Models are created lazily by MonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [MonitorModelsModule],
  controllers: [SystemController],
  providers: [SystemService, NodeCacheService],
  exports: [SystemService, NodeCacheService],
})
export class SystemModule {}
