import { BadRequestException, Controller, HttpException, HttpStatus, Post, Req, Headers, Body } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { SiteService } from "@modules/web-monitor/modules/site/site.service";
import { ConfigService } from "@nestjs/config";
import { func, getRandomIp } from "../../shared/utils";
import { DayReportNumService } from "@modules/web-monitor/modules/day-report/day-report-num.service";
import { RedisService } from "@modules/redis/redis.service";
import { RedisKeys } from "../../models/enum";
import { WebTokenResolver } from "../../services/web-token.resolver";

@ApiTags("Frontend Monitor / Web / Report")
@Controller("/api/v1")
export class WebReportController {
  private config: Record<string, unknown>;

  constructor(
    private readonly site: SiteService,
    private readonly configService: ConfigService,
    private readonly dayReportNum: DayReportNumService,
    private readonly redis: RedisService,
    private readonly tokenResolver: WebTokenResolver,
  ) {
    this.config = this.configService.get("modules.web-monitor") || {};
  }

  @Post("/report/web")
  @ApiOperation({ summary: "Web SDK data report endpoint" })
  @ApiResponse({ type: String })
  async webReport(
    @Req() req: Request,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: Record<string, unknown> | string,
  ) {
    let query: Record<string, unknown> = typeof body === "string" ? JSON.parse(body) : body;

    if (req.headers["content-type"] && req.headers["content-type"].includes("text/plain")) {
      query = JSON.parse(body as string);
    }
    // The SDK presents the secret WebMonitorInstallation token; the server resolves
    // the public appKey (storage partition key) from it. appId is no longer a
    // credential. Resolution is cached and liveness writes are throttled.
    const { appKey } = await this.tokenResolver.resolve(query.token as string | undefined);
    query.appId = appKey;

    query.ip = func.getRealIp(req.headers, req.ip);
    if (this.config.isLocalDev) query.ip = getRandomIp();

    query.url = query.url || headers["referer"];
    query.userAgent = headers["user-agent"];

    const system = await this.site.getSiteForAppId(String(query.appId));
    if (!system?.appId) throw new BadRequestException(`appId:${query.appId} does not exist`);

    await this.saveWebReportDataForRedis(query);
    return func.result({ data: "ok" });
  }

  private async saveWebReportDataForRedis(query: Record<string, unknown>) {
    const consumption = func.isObject(this.config.redis_consumption) ? this.config.redis_consumption : {};
    const limit = Number(consumption.total_limit_web) || 0;
    if (limit) {
      const length = await this.redis.getClient().llen(RedisKeys.WEB_REPORT_DATAS);
      if (length >= limit)
        throw new HttpException(
          `redis: ${RedisKeys.WEB_REPORT_DATAS}: rate limit reached (${limit})`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    await this.redis.getClient().lpush(RedisKeys.WEB_REPORT_DATAS, JSON.stringify(query));
    await this.dayReportNum.redisCount(String(query.appId));
  }
}
