import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";

import { HubReportDto, HubReportResponseDto } from "../module-hub.dto";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Token-only public endpoint for installation self-reports.
 *
 * Host auth (JWT/Guard) is bypassed here: authentication is the
 * X-Module-Hub-Token header, resolved against ModuleHubInstallation.tokenHash.
 *
 * One endpoint carries two report kinds (design doc §4.2):
 * - "full": process-start self-registration with runtime facts and snapshot;
 * - "ping": periodic liveness touch without snapshot.
 *
 * The hub never dispatches pending changes — module upgrades happen via
 * `newbie update` + deploy, and the resulting snapshot IS the receipt.
 */
@ApiTags("Module Hub")
@Controller("module-hub")
export class ReportController {
  constructor(
    private readonly installations: ModuleHubInstallationService,
    private readonly releases: ModuleHubReleaseService,
  ) {}

  @Post("report")
  @NoGuard()
  async report(
    @Headers("x-module-hub-token") token: string,
    @Body() body: HubReportDto,
  ): Promise<HubReportResponseDto> {
    if (!token) {
      throw new UnauthorizedException("Missing X-Module-Hub-Token header.");
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }

    // Extract a representative registry sourceCommit from the first module
    // entry, if any. The hub stores it as a convenience column for
    // "is upgradable" checks without re-parsing modulesSnapshot.
    const modules = body.modules ?? [];
    const firstSourceCommit = modules.find(
      (m) => m && typeof (m as { sourceCommit?: unknown }).sourceCommit === "string",
    )?.sourceCommit;
    const registrySourceCommit = typeof firstSourceCommit === "string" ? firstSourceCommit : undefined;

    // Refresh runtime facts (firstSeenAt is written exactly once via COALESCE
    // on the first "full" report; "ping" only touches lastSeenAt).
    await this.installations.touchOnReport(installation.id, {
      kind: body.kind,
      framework: body.framework,
      frameworkVersion: body.frameworkVersion,
      appVersion: body.appVersion,
      env: body.env,
      instanceId: body.instanceId,
      modules: body.modules,
      registrySourceCommit,
    });

    return {
      serverTime: new Date(),
      reportIntervalSeconds: 60,
      latestRegistrySourceCommit: (await this.releases.getLatestRegistrySourceCommit()) ?? undefined,
    };
  }
}
