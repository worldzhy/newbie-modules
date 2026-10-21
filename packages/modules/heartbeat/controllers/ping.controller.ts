import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { AllowAnyOrigin } from "@devbie/newbie/cors/allow-any-origin.decorator";
import { HeartbeatInstallation } from "@generated/prisma/client";
import { InstallationAuth } from "@modules/security/authentication/installation/installation.decorator";

import { HeartbeatPingDto, HeartbeatPingResponseDto } from "../heartbeat.dto";
import { HeartbeatInstallationService, PING_INTERVAL_SECONDS } from "../services/installation.service";

/**
 * Token-only public endpoint for heartbeat pings (ADR-016).
 *
 * Authentication is the installation token presented as
 * `Authorization: Bearer <token>` (the X-Heartbeat-Token header is a
 * deprecated alias during the SDK migration window), resolved against
 * HeartbeatInstallation.tokenHash by the InstallationAuthGuard.
 *
 * A ping is a pure liveness touch — no snapshots, no command channel. The
 * response carries serverTime and the requested ping interval so clients can
 * be throttled server-side without a client upgrade.
 */
@ApiTags("Heartbeat")
@Controller("heartbeat")
export class PingController {
  constructor(private readonly installations: HeartbeatInstallationService) {}

  @Post("ping")
  @InstallationAuth("heartbeat")
  @AllowAnyOrigin()
  @ApiCreatedResponse({ type: HeartbeatPingResponseDto })
  async ping(
    @Req() req: Request & { installation: HeartbeatInstallation },
    @Body() body: HeartbeatPingDto,
  ): Promise<HeartbeatPingResponseDto> {
    await this.installations.recordPing(req.installation.id, {
      appVersion: body.appVersion,
      env: body.env,
      instanceId: body.instanceId,
    });

    return {
      serverTime: new Date(),
      reportIntervalSeconds: PING_INTERVAL_SECONDS,
    };
  }
}
