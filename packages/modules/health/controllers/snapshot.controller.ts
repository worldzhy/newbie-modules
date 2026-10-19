import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { HealthInstallation } from "@generated/prisma/client";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";
import { PublicCors } from "@modules/security/authentication/public/public-cors.decorator";

import { HealthSnapshotDto, HealthSnapshotResponseDto } from "../health.dto";
import { HealthInstallationService, SNAPSHOT_INTERVAL_SECONDS } from "../services/installation.service";

/**
 * Token-only public endpoint for health snapshots (ADR-016).
 *
 * Authentication is the installation token presented as
 * `Authorization: Bearer <token>` (the X-Health-Token header is a deprecated
 * alias during the SDK migration window), resolved against
 * HealthInstallation.tokenHash by the InstallationAuthGuard.
 *
 * A snapshot carries the aggregated dependency health status ("ok" | "error")
 * and per-indicator results. The response carries serverTime and the
 * requested snapshot interval so clients can be throttled server-side.
 */
@ApiTags("Health")
@Controller("health")
export class SnapshotController {
  constructor(private readonly installations: HealthInstallationService) {}

  @Post("snapshot")
  @InstallationAuth("health")
  @PublicCors()
  async snapshot(
    @Req() req: Request & { installation: HealthInstallation },
    @Body() body: HealthSnapshotDto,
  ): Promise<HealthSnapshotResponseDto> {
    await this.installations.recordSnapshot(req.installation.id, {
      appVersion: body.appVersion,
      env: body.env,
      instanceId: body.instanceId,
      status: body.status,
      info: body.info,
    });

    return {
      serverTime: new Date(),
      reportIntervalSeconds: SNAPSHOT_INTERVAL_SECONDS,
    };
  }
}
