import { BadRequestException, Controller, HttpException, HttpStatus, Post, Req, Headers, Body } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { SiteService } from "@modules/web-monitor/modules/site/site.service";
import { ConfigService } from "@nestjs/config";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { func, getRandomIp } from "../../shared/utils";
import { DayReportNumService } from "@modules/web-monitor/modules/day-report/day-report-num.service";
import { RedisService } from "@modules/redis/redis.service";
import { RedisKeys } from "../../models/enum";
import { ResolvedWebToken, WebTokenResolver } from "../../services/web-token.resolver";

/**
 * Token-only public endpoint for web-monitor ingestion (ADR-016), peer to
 * heartbeat/health/backend-monitor/module-hub. The secret
 * WebMonitorInstallation token travels in the request body because the
 * browser SDK posts via navigator.sendBeacon, which cannot set headers —
 * the documented exception to the Bearer standard. The InstallationAuthGuard
 * resolves it to the public appKey (storage partition key); appId is no
 * longer a credential. Resolution is cached and liveness writes are
 * throttled.
 */
@ApiTags("Frontend Monitor / Web / Report")
@Controller("/web-monitor")
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

  @Post("/report")
  @InstallationAuth("web-monitor")
  @AllowAnyOrigin()
  @ApiOperation({ summary: "Web SDK data report endpoint" })
  @ApiResponse({ type: String })
  async webReport(
    @Req() req: Request & { installation: ResolvedWebToken },
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: Record<string, unknown> | string,
  ) {
    let query: Record<string, unknown> = typeof body === "string" ? JSON.parse(body) : body;

    if (req.headers["content-type"] && req.headers["content-type"].includes("text/plain")) {
      query = JSON.parse(body as string);
    }

    const { installationId, appKey } = req.installation;
    await this.tokenResolver.touchOnReport(installationId);
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
