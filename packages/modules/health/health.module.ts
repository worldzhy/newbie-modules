import { Global, Module } from "@nestjs/common";

import { installationResolverToken } from "@modules/security/ports/installation.resolver";
import { InstallationController } from "./controllers/installation.controller";
import { SnapshotController } from "./controllers/snapshot.controller";
import { HealthInstallationService } from "./services/installation.service";

/**
 * Health — dependency health plane for deployment endpoints.
 *
 * - InstallationController: host integration (installation lifecycle).
 *   Protected by the host's own auth.
 * - SnapshotController: token-only open endpoint where running processes
 *   report dependency health snapshots (aggregated status + per-indicator
 *   results).
 *
 * Cross-cutting by design: a newbie backend, a fewbie SSR process, or any
 * other node service can each hold a health token independently of
 * backend-monitor / module-hub.
 */
@Global()
@Module({
  controllers: [InstallationController, SnapshotController],
  providers: [
    HealthInstallationService,
    // Bind the installation credential store to security's SPI port (ADR-016);
    // useExisting keeps the singleton so service state is never duplicated.
    { provide: installationResolverToken("health"), useExisting: HealthInstallationService },
  ],
  exports: [HealthInstallationService, installationResolverToken("health")],
})
export class HealthModule {}
