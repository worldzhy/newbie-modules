import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { NoGuard } from "@modules/account/security/passport/public/public.decorator";

import { HubAgentPollDto } from "../module-hub.dto";
import { ModuleHubChangeRequestService } from "../services/change-request.service";
import { ModuleHubInstallationService } from "../services/installation.service";
import { ModuleHubReleaseService } from "../services/release.service";

/**
 * Token-only public endpoint for CLI agents.
 *
 * Host auth (JWT/Guard) is bypassed here: authentication is the
 * X-Module-Hub-Token header, resolved against HubInstallation.tokenHash.
 */
@ApiTags("Module Hub")
@Controller("module-hub/agent")
export class AgentPollController {
  constructor(
    private readonly installations: ModuleHubInstallationService,
    private readonly releases: ModuleHubReleaseService,
    private readonly changes: ModuleHubChangeRequestService,
  ) {}

  @Post("poll")
  @NoGuard()
  async poll(@Headers("x-module-hub-token") token: string, @Body() body: HubAgentPollDto) {
    if (!token) {
      throw new UnauthorizedException("Missing X-Module-Hub-Token header.");
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }

    // Refresh runtime facts (firstSeenAt written exactly once via COALESCE).
    await this.installations.touchOnPoll(installation.id, {
      cliVersion: body.cliVersion,
      status: body.status,
    });

    // Process receipts from the previous poll (outcomes for RUNNING requests).
    if (body.results && body.results.length > 0) {
      await this.changes.processResults(installation.id, body.results);
    }

    // Atomically claim PENDING -> RUNNING and return them.
    const pendingChanges = await this.changes.claimPending(installation.id);
    const latestRegistrySourceCommit = await this.releases.getLatestRegistrySourceCommit();

    return {
      serverTime: new Date().toISOString(),
      pollIntervalSeconds: 60,
      latestRegistrySourceCommit,
      pendingChanges,
    };
  }
}
