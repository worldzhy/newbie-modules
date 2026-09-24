import {Module} from '@nestjs/common';
import {DayReportNumService} from './day-report-num.service';
import {RedisModule} from '../../models/redis/redis.module';
import {ConfigModule} from '@nestjs/config';
import {MonitorModelsModule} from '../../models/mongo/monitor-models.module';

@Module({
  imports: [ConfigModule, RedisModule, MonitorModelsModule],
  providers: [DayReportNumService],
  exports: [DayReportNumService],
})
export class DayReportModule {}
