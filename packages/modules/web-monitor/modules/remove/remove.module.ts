import {Module} from '@nestjs/common';
import {RemoveController} from './remove.controller';
import {RemoveService} from './remove.service';
import {MonitorModelsModule} from '../../models/mongo/monitor-models.module';
import {MonitorClickhouseModule} from '../../models/clickhouse/monitor-clickhouse.module';

@Module({
  imports: [MonitorModelsModule, MonitorClickhouseModule],
  controllers: [RemoveController],
  providers: [RemoveService],
  exports: [RemoveService],
})
export class RemoveModule {}
