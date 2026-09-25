import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {Cron, SchedulerRegistry} from '@nestjs/schedule';
import {CronJob} from 'cron';
import {ConfigService} from '@nestjs/config';
import {RedisService} from '../../models/redis/redis.service';
import {SystemService} from '../../modules/system/system.service';
import {NodeCacheService} from '../../shared/node-cache.service';
import {func} from '../../shared/utils';
import {DayReportNumService} from '../../modules/day-report/day-report-num.service';
import {RedisKeys} from '../../models/enum';
import {WebReportTaskService} from '../../modules/web/services/report-task.service';
import {WebPvuvipTaskService} from '../../modules/web/services/pvuvip-task.service';
import {WebIpTaskService} from '../../modules/web/services/ip-task.service';
import {WxReportTaskService} from '../../modules/wx/services/report-task.service';
import {WxPvuvipTaskService} from '../../modules/wx/services/pvuvip-task.service';
import {WxIpTaskService} from '../../modules/wx/services/ip-task.service';
import ip from 'ip';

@Injectable()
export class JobsService implements OnModuleInit {
  private cfg: any;
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly system: SystemService,
    private readonly nodeCache: NodeCacheService,
    private readonly dayReportNum: DayReportNumService,
    private readonly scheduler: SchedulerRegistry,
    private readonly webReportTask: WebReportTaskService,
    private readonly webPvuvipTask: WebPvuvipTaskService,
    private readonly webIpTask: WebIpTaskService,
    private readonly wxReportTask: WxReportTaskService,
    private readonly wxPvuvipTask: WxPvuvipTaskService,
    private readonly wxIpTask: WxIpTaskService
  ) {
    this.cfg = this.configService.get('modules.frontend-monitor');
  }

  async onModuleInit() {
    await this.updateAppInfoCache();
    await this.pvuvipMinuteCount();
    await this.ipTask();
    await this.dayReportNumTask();
    this.registerReportStoreTask();
    this.registerAlarmTask();
  }

  private registerReportStoreTask() {
    const expr = this.cfg.redis_consumption?.task_time || '*/10 * * * * *';
    const job = new CronJob(
      expr,
      async () => {
        await this.consumeReportQueues();
      },
      null,
      true,
      'Asia/Shanghai'
    );
    this.scheduler.addCronJob('consumeReportQueues', job);
    job.start();
  }

  private registerAlarmTask() {
    if (!this.cfg.alarm) return;
    const expr = this.cfg.alarm_task_cron_time;
    if (!expr) return;
    const job = new CronJob(
      expr,
      async () => {
        await this.alarmTask();
      },
      null,
      true,
      'Asia/Shanghai'
    );
    this.scheduler.addCronJob('alarmTask', job);
    job.start();
  }

  async alarmTask() {}

  private async redisLock(redisKey: string, ttl: number) {
    const lock = `${ip.address()}:${this.cfg.port}:${func.randomString(3)}`;
    const res = await this.redis.set(redisKey, lock, 'EX', ttl, 'NX');
    if (!res) {
      // Lock is held by another instance — normal in multi-instance deployments.
      // Log at verbose level so it doesn't spam the console every minute.
      this.logger.verbose(`Lock [${redisKey}] not acquired (held by another instance)`);
      return false;
    }
    const dbLock = await this.redis.get(redisKey);
    if (lock !== dbLock) {
      // Lock verification failed — could indicate a race or Redis issue, worth warning.
      this.logger.warn(`Lock [${redisKey}] verification failed: expected ${lock}, got ${dbLock}`);
      return false;
    }
    // Lock acquired successfully — normal event, log at verbose level to avoid noise.
    this.logger.verbose(`Lock [${redisKey}] acquired: ${lock}`);
    return true;
  }

  @Cron('0 */5 * * * *', {timeZone: 'Asia/Shanghai'})
  async updateAppInfoCache() {
    try {
      const systems = await this.system.getSystemList();
      this.nodeCache.updateAllSystemCache(systems as any);
    } catch (e) {
      console.error('IO错误：更新缓存appid信息出错', e?.message || e);
    }
  }

  @Cron('0 */2 * * * *', {timeZone: 'Asia/Shanghai'})
  async pvuvipMinuteCount() {
    const getLock = await this.redisLock(RedisKeys.PVUVIP_PRE_MINUTE_LOCK, this.cfg.pvuvip_task_minute_lock_time);
    if (!getLock) return;
    await this.webPvuvipTask.getWebPvUvIpByMinute();
    await this.wxPvuvipTask.getWxPvUvIpByMinute();
  }

  @Cron('0 */1 * * * *', {timeZone: 'Asia/Shanghai'})
  async ipTask() {
    const getLock = await this.redisLock(RedisKeys.IP_TASK_LOCK, this.cfg.ip_task_lock_time);
    if (!getLock) return;
    await this.webIpTask.saveWebGetIpDatas();
    await this.wxIpTask.saveWxGetIpDatas();
  }

  @Cron('0 0 0 */1 * *', {timeZone: 'Asia/Shanghai'})
  async dayReportNumTask() {
    const getLock = await this.redisLock(RedisKeys.DAY_REPORT_NUM_TASK_LOCK, this.cfg.day_report_num_task_lock_time);
    if (!getLock) return;
    await this.dayReportNum.numCountTask();
  }

  @Cron('0 0 0 */1 * *', {timeZone: 'Asia/Shanghai'})
  async preDayReportTask() {
    if (!this.cfg.day_report) return;
    const getLock = await this.redisLock(RedisKeys.DAY_REPORT_TASK_LOCK, this.cfg.day_report_task_lock_time);
    if (!getLock) return;
  }

  async consumeReportQueues() {
    // 使用配置中的时间表达式
    try {
      if (this.cfg.is_web_consume_task_run) await this.consumeWebQueue();
      if (this.cfg.is_wx_consume_task_run) await this.consumeWxQueue();
    } catch (e) {
      console.error('消费队列异常', e?.message || e);
    }
    // 后续可按需拆分到独立 Cron 任务
  }

  private async consumeWebQueue() {
    await this.webReportTask.saveWebReportDatasForRedis();
  }

  private async consumeWxQueue() {
    await this.wxReportTask.saveWxReportDatasForRedis();
  }
}
