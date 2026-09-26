import {Module} from '@nestjs/common';
import {JobsService} from './jobs.service';
import {RedisModule} from '../../models/redis/redis.module';
import {SystemModule} from '../../modules/system/system.module';

import {DayReportModule} from '../../modules/day-report/day-report.module';
import {MonitorClickhouseModule} from '../../models/clickhouse/monitor-clickhouse.module';

import {WebModule} from '../../modules/web/web.module';

// WebPvuvip is created lazily by MonitorModelsService on the shared connection,
// so no MongooseModule.forFeature registration is needed here.
@Module({
  imports: [RedisModule, SystemModule, DayReportModule, MonitorClickhouseModule, WebModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
