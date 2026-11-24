import { Global, Module } from "@nestjs/common";

import { InstallationKindRegistry, InstallationKindWire } from "@modules/security/installation/installation-kind";
import { InstallationController } from "./controllers/installation.controller";
import { PingController } from "./controllers/ping.controller";
import {
  HeartbeatInstallationService,
  ONLINE_THRESHOLD_SECONDS,
  PING_INTERVAL_SECONDS,
} from "./services/installation.service";

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
  providers: [HeartbeatInstallationService],
  exports: [HeartbeatInstallationService],
})
export class HeartbeatModule {
  constructor(registry: InstallationKindRegistry) {
    // Declare this collector's kind once (ADR-078 decision 3). Security
    // executes the declaration and holds no heartbeat-specific constant.
    registry.register({
      kind: InstallationKindWire.HEARTBEAT,
      endpoint: "/heartbeat/ping",
      reportIntervalSeconds: PING_INTERVAL_SECONDS,
      offlineAfterSeconds: ONLINE_THRESHOLD_SECONDS,
      requiresAppKey: false,
      budget: { perKey: { points: 120, durationSeconds: 60 }, scope: "token" },
      legacyHeader: "x-heartbeat-token",
    });
  }
}
