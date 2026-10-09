import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";

import { HealthSnapshotDto, HealthSnapshotResponseDto } from "../health.dto";
import { HealthInstallationService, SNAPSHOT_INTERVAL_SECONDS } from "../services/installation.service";

/**
 * Token-only public endpoint for health snapshots.
 *
 * Host auth (JWT/Guard) is bypassed here: authentication is the
 * X-Health-Token header, resolved against HealthInstallation.tokenHash.
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
  @NoGuard()
  async snapshot(
    @Headers("x-health-token") token: string,
    @Body() body: HealthSnapshotDto,
  ): Promise<HealthSnapshotResponseDto> {
    if (!token) {
      throw new UnauthorizedException("Missing X-Health-Token header.");
    }

    const accepted = await this.installations.recordSnapshot(token, {
      appVersion: body.appVersion,
      env: body.env,
      instanceId: body.instanceId,
      status: body.status,
      info: body.info,
    });
    if (!accepted) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }

    return {
      serverTime: new Date(),
      reportIntervalSeconds: SNAPSHOT_INTERVAL_SECONDS,
    };
  }
}
