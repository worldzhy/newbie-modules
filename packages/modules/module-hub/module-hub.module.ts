import { Global, Module } from "@nestjs/common";

import { installationResolverToken } from "@modules/security/ports/installation.resolver";
import { InstallationController } from "./controllers/installation.controller";
import { ReportController } from "./controllers/report.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { ModuleHubInstallationService } from "./services/installation.service";
import { ModuleHubReleaseService } from "./services/release.service";

/**
 * Module Hub — observer plane for remote installation management.
 *
 * - InstallationController: host integration (installation lifecycle,
 *   catalog). Protected by the host's own auth.
 * - ReportController: token-only open endpoint where running instances report
 *   process-start facts and periodic liveness. Module upgrades happen via
 *   `newbie update` + deploy; the resulting snapshot IS the receipt.
 * - WebhookController: registry push ingestion. HMAC verified.
 */
@Global()
@Module({
  controllers: [InstallationController, ReportController, WebhookController],
  providers: [
    ModuleHubInstallationService,
    ModuleHubReleaseService,
    // Bind the installation credential store to security's SPI port (ADR-016);
    // useExisting keeps the singleton so service state is never duplicated.
    { provide: installationResolverToken("module-hub"), useExisting: ModuleHubInstallationService },
  ],
  exports: [ModuleHubInstallationService, ModuleHubReleaseService, installationResolverToken("module-hub")],
})
export class ModuleHubModule {}
