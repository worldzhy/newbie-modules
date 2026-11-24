import { Global, Module } from "@nestjs/common";

import { InstallationKindRegistry, InstallationKindWire } from "@modules/security/installation/installation-kind";
import { InstallationController } from "./controllers/installation.controller";
import { MeController } from "./controllers/me.controller";
import { ReportController } from "./controllers/report.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { MODULE_HUB_REPORTS_PATH } from "./module-hub.routes";
import {
  ModuleHubInstallationService,
  ONLINE_THRESHOLD_SECONDS,
  REPORT_INTERVAL_SECONDS,
} from "./services/installation.service";
import { ModuleHubReleaseService } from "./services/release.service";

/**
 * Module Hub — observer plane for remote installation management.
 *
 * - InstallationController: host integration (installation lifecycle,
 *   catalog). Protected by the host's own auth.
 * - ReportController: token-only open endpoint where running instances report
 *   process-start facts and periodic liveness. Module upgrades happen via
 *   `newbie modules update` + deploy; the resulting snapshot IS the receipt.
 * - MeController: token-only read of the caller's own installation snapshot
 *   (`GET /module-hub/me/modules`), used by `newbie module-hub verify` (no
 *   host user session required).
 * - WebhookController: registry push ingestion. HMAC verified.
 */
@Global()
@Module({
  controllers: [InstallationController, ReportController, MeController, WebhookController],
  providers: [ModuleHubInstallationService, ModuleHubReleaseService],
  exports: [ModuleHubInstallationService, ModuleHubReleaseService],
})
export class ModuleHubModule {
  constructor(registry: InstallationKindRegistry) {
    // Declare this collector's kind once (ADR-078 decision 3). Security
    // executes the declaration and holds no module-hub-specific constant.
    registry.register({
      kind: InstallationKindWire.MODULE_HUB,
      endpoint: MODULE_HUB_REPORTS_PATH,
      reportIntervalSeconds: REPORT_INTERVAL_SECONDS,
      offlineAfterSeconds: ONLINE_THRESHOLD_SECONDS,
      requiresAppKey: false,
      budget: { perKey: { points: 120, durationSeconds: 60 }, scope: "token" },
      legacyHeader: "x-module-hub-token",
    });
  }
}
