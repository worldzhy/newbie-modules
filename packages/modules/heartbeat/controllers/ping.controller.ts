import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";

import { HeartbeatPingDto, HeartbeatPingResponseDto } from "../heartbeat.dto";
import { HeartbeatInstallationService, PING_INTERVAL_SECONDS } from "../services/installation.service";

/**
 * Token-only public endpoint for heartbeat pings.
 *
 * Host auth (JWT/Guard) is bypassed here: authentication is the
 * X-Heartbeat-Token header, resolved against HeartbeatInstallation.tokenHash.
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
  @NoGuard()
  async ping(
    @Headers("x-heartbeat-token") token: string,
    @Body() body: HeartbeatPingDto,
  ): Promise<HeartbeatPingResponseDto> {
    if (!token) {
      throw new UnauthorizedException("Missing X-Heartbeat-Token header.");
    }

    const accepted = await this.installations.recordPing(token, {
      appVersion: body.appVersion,
      env: body.env,
      instanceId: body.instanceId,
    });
    if (!accepted) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }

    return {
      serverTime: new Date(),
      reportIntervalSeconds: PING_INTERVAL_SECONDS,
    };
  }
}
