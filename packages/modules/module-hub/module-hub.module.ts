import { Module } from "@nestjs/common";

import { AgentPollController } from "./controllers/agent-poll.controller";
import { InstallationsController } from "./controllers/installations.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { ModuleHubChangeRequestService } from "./services/change-request.service";
import { ModuleHubInstallationService } from "./services/installation.service";
import { ModuleHubReleaseService } from "./services/release.service";

/**
 * Module Hub — control plane for remote installation management.
 *
 * - InstallationsController: host integration (installation lifecycle, catalog,
 *   change-request creation). Protected by the host's own auth.
 * - AgentPollController: token-only open endpoint where CLI agents report
 *   status and pick up pending changes.
 * - WebhookController: registry push ingestion. HMAC verified.
 */
@Module({
  controllers: [InstallationsController, AgentPollController, WebhookController],
  providers: [ModuleHubInstallationService, ModuleHubChangeRequestService, ModuleHubReleaseService],
  exports: [ModuleHubInstallationService, ModuleHubChangeRequestService, ModuleHubReleaseService],
})
export class ModuleHubModule {}
