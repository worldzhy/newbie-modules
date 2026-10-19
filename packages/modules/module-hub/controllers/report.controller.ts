import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { ModuleHubInstallation } from "@generated/prisma/client";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { PublicCors } from "@modules/security/authentication/public/public-cors.decorator";

import { HubReportDto, HubReportResponseDto } from "../module-hub.dto";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Token-only public endpoint for installation self-reports (ADR-016).
 *
 * Authentication is the installation token presented as
 * `Authorization: Bearer <token>` (the X-Module-Hub-Token header is a
 * deprecated alias during the SDK migration window), resolved against
 * ModuleHubInstallation.tokenHash by the InstallationAuthGuard.
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
  @InstallationAuth("module-hub")
  @PublicCors()
  async report(
    @Req() req: Request & { installation: ModuleHubInstallation },
    @Body() body: HubReportDto,
  ): Promise<HubReportResponseDto> {
    const installation = req.installation;

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
