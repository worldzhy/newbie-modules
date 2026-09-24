import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {RedisModule} from '../../models/redis/redis.module';
import {SystemModule} from '../../modules/system/system.module';
import {DayReportModule} from '../../modules/day-report/day-report.module';
import {MonitorClickhouseModule} from '../../models/clickhouse/monitor-clickhouse.module';
import {MonitorModelsModule} from '../../models/mongo/monitor-models.module';

import {WxReportController} from './report.controller';
import {WxAjaxController} from './ajax.controller';
import {WxErrorController} from './error.controller';
import {WxPageController} from './page.controller';
import {WxAnalysisController} from './analysis.controller';
import {WxPvuvipController} from './pvuvip.controller';
import {WxCustomController} from './custom.controller';
import {WxEventController} from './event.controller';

import {WxReportTaskService} from './services/report-task.service';
import {WxPvuvipTaskService} from './services/pvuvip-task.service';
import {WxIpTaskService} from './services/ip-task.service';
import {WxAjaxService} from './services/ajax.service';
import {WxErrorService} from './services/error.service';
import {WxPageService} from './services/page.service';
import {WxAnalysisService} from './services/analysis.service';
import {WxPvuvipService} from './services/pvuvip.service';
import {WxEventService} from './services/event.service';
import {WxCustomService} from './services/custom.service';

@Module({
  imports: [ConfigModule, RedisModule, SystemModule, DayReportModule, MonitorClickhouseModule, MonitorModelsModule],
  controllers: [
    WxReportController,
    WxAjaxController,
    WxErrorController,
    WxPageController,
    WxAnalysisController,
    WxPvuvipController,
    WxCustomController,
    WxEventController,
  ],
  providers: [
    WxReportTaskService,
    WxPvuvipTaskService,
    WxIpTaskService,
    WxAjaxService,
    WxErrorService,
    WxPageService,
    WxAnalysisService,
    WxPvuvipService,
    WxEventService,
    WxCustomService,
  ],
  exports: [WxReportTaskService, WxPvuvipTaskService, WxIpTaskService],
})
export class WxModule {}
