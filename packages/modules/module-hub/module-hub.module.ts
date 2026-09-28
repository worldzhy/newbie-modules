import { Module } from "@nestjs/common";

import { InstallationsController } from "./controllers/installations.controller";
import { ReportController } from "./controllers/report.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { ModuleHubInstallationService } from "./services/installation.service";
import { ModuleHubReleaseService } from "./services/release.service";

/**
 * Module Hub — observer plane for remote installation management.
 *
 * - InstallationsController: host integration (installation lifecycle,
 *   catalog). Protected by the host's own auth.
 * - ReportController: token-only open endpoint where running instances report
 *   process-start facts and periodic liveness. Module upgrades happen via
 *   `newbie update` + deploy; the resulting snapshot IS the receipt.
 * - WebhookController: registry push ingestion. HMAC verified.
 */
@Module({
  controllers: [InstallationsController, ReportController, WebhookController],
  providers: [ModuleHubInstallationService, ModuleHubReleaseService],
  exports: [ModuleHubInstallationService, ModuleHubReleaseService],
})
export class ModuleHubModule {}
