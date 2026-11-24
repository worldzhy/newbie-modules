import { BadRequestException, Controller, HttpException, HttpStatus, Post, Req, Headers, Body } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { SiteService } from "@modules/frontend-monitor/modules/site/site.service";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { func } from "../../shared/utils";
import { FRONTEND_MONITOR_CONFIG } from "../../shared/frontend-monitor-config";
import { DayReportNumService } from "@modules/frontend-monitor/modules/day-report/day-report-num.service";
import { RedisService } from "@modules/redis/redis.service";
import { RedisKeys } from "../../models/enum";
import { Installation } from "@generated/prisma/client";
import { FrontendMonitorInstallationService } from "../../services/frontend-monitor-installation.service";

/**
 * Token-only public ingestion endpoint (ADR-016), the standard `reports`
 * collection under `/frontend-monitor` (ADR-073). The secret
 * FrontendMonitorInstallation token travels in the request body because the
 * browser SDK posts via navigator.sendBeacon, which cannot set headers —
 * the documented exception to the Bearer standard. The InstallationAuthGuard
 * resolves the shared `Installation` row and its appKey; appKey is no longer a
 * credential. Liveness writes are throttled.
 */
@ApiTags("Frontend Monitor / Web / Report")
@Controller("/frontend-monitor")
export class FrontendMonitorReportController {
  constructor(
    private readonly site: SiteService,
    private readonly dayReportNum: DayReportNumService,
    private readonly redis: RedisService,
    private readonly installations: FrontendMonitorInstallationService,
  ) {}

  @Post("reports")
  @InstallationAuth("frontend-monitor")
  @AllowAnyOrigin()
  @ApiOperation({ summary: "Web SDK data report endpoint" })
  @ApiResponse({ type: String })
  async webReport(
    @Req() req: Request & { installation: Installation },
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: Record<string, unknown> | string,
  ) {
    let query: Record<string, unknown>;
    try {
      query = typeof body === "string" ? JSON.parse(body) : body;
    } catch {
      throw new BadRequestException("Invalid report payload");
    }
    if (!query || typeof query !== "object") {
      throw new BadRequestException("Invalid report payload");
    }

    const installationId = req.installation.id;
    const appKey = req.installation.appKey;
    if (!appKey) throw new BadRequestException(`appKey: does not exist`);
    await this.installations.touchOnReport(installationId);
    query.appKey = appKey;
    // The SDK submits its installation token in the body (sendBeacon cannot set
    // headers). It has done its job in the guard and must not reach the Redis
    // queue — nor the dead-letter list — as plaintext where it would outlive
    // the request.
    delete query.token;

    query.ip = func.getRealIp(req.headers, req.ip);

    // The client normally trims the query/fragment itself, but the Referer
    // fallback is a raw browser header. Sanitize before the payload enters the
    // Redis queue so credentials never land there as plaintext (R1-05).
    const reportedUrl = typeof query.url === "string" ? query.url : "";
    query.url = reportedUrl
      ? func.sanitizeUrlForStorage(reportedUrl)
      : func.sanitizeUrlForStorage(headers["referer"] || "");
    query.userAgent = headers["user-agent"];

    const system = await this.site.getSiteForAppId(String(query.appKey));
    if (!system?.appKey) throw new BadRequestException(`appKey: does not exist`);

    await this.saveWebReportDataForRedis(query);
    return func.result({ data: "ok" });
  }

  private async saveWebReportDataForRedis(query: Record<string, unknown>) {
    const consumption = FRONTEND_MONITOR_CONFIG.redis_consumption;
    const limit = Number(consumption.total_limit_web) || 0;
    if (limit) {
      const length = await this.redis.getClient().llen(RedisKeys.FRONTEND_REPORT_DATAS);
      if (length >= limit)
        throw new HttpException(
          `redis: ${RedisKeys.FRONTEND_REPORT_DATAS}: rate limit reached (${limit})`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
    }
    await this.redis.getClient().lpush(RedisKeys.FRONTEND_REPORT_DATAS, JSON.stringify(query));
    await this.dayReportNum.redisCount(String(query.appKey));
  }
}
