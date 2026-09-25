import {Controller, Post, Req, Headers, Body, UnauthorizedException} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Request} from 'express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {AgentStatus, AgentType} from '@generated/prisma/enums';
import {SystemService} from '../../modules/system/system.service';
import {ConfigService} from '@nestjs/config';
import {func, getRandomIp} from '../../shared/utils';
import {DayReportNumService} from '../../modules/day-report/day-report-num.service';
import {RedisService} from '../../models/redis/redis.service';
import {RedisKeys} from '../../models/enum';

@ApiTags('Frontend Monitor / Web / Report')
@Controller('/api/v1')
export class WebReportController {
  private config: any;

  constructor(
    private readonly system: SystemService,
    private readonly configService: ConfigService,
    private readonly dayReportNum: DayReportNumService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService
  ) {
    this.config = this.configService.get('modules.frontend-monitor');
  }

  @Post('/report/web')
  @ApiOperation({summary: 'Web SDK data report endpoint'})
  @ApiResponse({type: String})
  async webReport(@Req() req: Request, @Headers() headers: Record<string, string | undefined>, @Body() body: any) {
    let query: any = body;

    if (req.headers['content-type'] && req.headers['content-type'].includes('text/plain')) {
      query = JSON.parse(body as string);
    }
    // The SDK presents the secret Agent token; the server resolves the public
    // appKey (storage partition key) from it. appId is no longer a credential.
    if (!query.token) throw new UnauthorizedException('web report token is required');

    const agent = await this.prisma.agent.findUnique({where: {token: query.token}});
    if (!agent || agent.type !== AgentType.WEB_MONITOR || agent.status === AgentStatus.DISABLED || !agent.appKey) {
      throw new UnauthorizedException('web report token is invalid or revoked');
    }

    // Downstream pipeline (Mongo collections, ClickHouse tables, day counters)
    // is keyed by appId, which is the agent's immutable appKey.
    query.appId = agent.appKey;

    query.ip = func.getRealIp(req.headers as any, req.ip);
    if (this.config.isLocalDev) query.ip = getRandomIp();

    query.url = query.url || headers['referer'];
    query.userAgent = headers['user-agent'];

    const system = await this.system.getSystemForAppId(query.appId);
    if (!system?.appId) throw new Error(`appId:${query.appId} 不存在`);

    // Anti-regression touch: never move lastSeenAt backwards; flips
    // PENDING -> ACTIVE on first contact. Fire-and-forget would lose
    // activation errors silently, so it is awaited before accepting data.
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "application"."Agent"
      SET "lastSeenAt" = ${now},
          "status" = CASE WHEN "status" = 'PENDING' THEN 'ACTIVE'::"application"."AgentStatus" ELSE "status" END
      WHERE "id" = ${agent.id}::uuid
        AND ("lastSeenAt" IS NULL OR "lastSeenAt" < ${now})
    `;

    await this.saveWebReportDataForRedis(query);
    return func.result({data: 'ok'});
  }

  private async saveWebReportDataForRedis(query: any) {
    const limit = this.config.redis_consumption?.total_limit_web;
    if (limit) {
      const length = await this.redis.llen(RedisKeys.WEB_REPORT_DATAS);
      if (length >= limit) throw new Error(`reids: ${RedisKeys.WEB_REPORT_DATAS}:达到限流（${limit}）`);
    }
    await this.redis.lpush(RedisKeys.WEB_REPORT_DATAS, JSON.stringify(query));
    await this.dayReportNum.redisCount(query.appId);
  }
}
