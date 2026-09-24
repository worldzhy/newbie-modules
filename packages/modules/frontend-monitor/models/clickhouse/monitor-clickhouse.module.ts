import {Global, Module} from '@nestjs/common';
import {MonitorClickhouseService} from './monitor-clickhouse.service';

@Global()
@Module({
  providers: [MonitorClickhouseService],
  exports: [MonitorClickhouseService],
})
export class MonitorClickhouseModule {}
