import { Global, Module } from "@nestjs/common";

import { INSTALLATION_RESOLVERS } from "@modules/security/ports/installation.resolver";
import { InstallationController } from "./controllers/installation.controller";
import { PingController } from "./controllers/ping.controller";
import { HeartbeatInstallationService } from "./services/installation.service";

/**
 * Heartbeat — pure liveness plane for deployment endpoints.
 *
 * - InstallationController: host integration (installation lifecycle).
 *   Protected by the host's own auth.
 * - PingController: token-only open endpoint where running processes report
 *   liveness. No snapshots, no command channel.
 *
 * Cross-cutting by design (design doc §9.3): a newbie backend, a fewbie SSR
 * process, or any other node service can each hold a heartbeat token
 * independently of backend-monitor / module-hub.
 */
@Global()
@Module({
  controllers: [InstallationController, PingController],
  providers: [
    HeartbeatInstallationService,
    // Bind the installation credential store to security's SPI port (ADR-016);
    // useExisting keeps the singleton so service state is never duplicated.
    { provide: INSTALLATION_RESOLVERS, useExisting: HeartbeatInstallationService, multi: true },
  ],
  exports: [HeartbeatInstallationService, INSTALLATION_RESOLVERS],
})
export class HeartbeatModule {}
