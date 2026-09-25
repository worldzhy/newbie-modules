import {Module} from '@nestjs/common';
import {ScheduleModule} from '@nestjs/schedule';
// Shared MongoDB connection module, consumed via the microservices path alias.
import {MongoModule} from '@modules/mongo/mongo.module';
import {RedisModule} from './models/redis/redis.module';
import {MonitorClickhouseModule} from './models/clickhouse/monitor-clickhouse.module';
import {SharedModule} from './shared/shared.module';
import {SystemModule} from './modules/system/system.module';
import {JobsModule} from './modules/jobs/jobs.module';
import {DayReportModule} from './modules/day-report/day-report.module';
import {MonitorModelsModule} from './models/mongo/monitor-models.module';
import {WebModule} from './modules/web/web.module';
import {WxModule} from './modules/wx/wx.module';
import {RemoveModule} from './modules/remove/remove.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongoModule,
    RedisModule,
    MonitorClickhouseModule,
    MonitorModelsModule,
    SharedModule,
    SystemModule,
    DayReportModule,
    JobsModule,
    WebModule,
    WxModule,
    RemoveModule,
  ],
  providers: [],
})
export class FrontendMonitorModule {}
